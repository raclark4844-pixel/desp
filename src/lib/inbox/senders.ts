import { z } from "zod";
import { db } from "../db";
import { audit, queueLock } from "../outreach/service";
import { SourceError } from "../lead-sources/contract";
export const fail = (message: string): never => {
  throw new SourceError(message, "failed");
};
export const phoneSchema = z
  .string()
  .regex(/^\+1[2-9]\d{9}$/, "Use a US/Canada phone number including +1.");
export async function registerSender(raw: unknown, actor: string) {
  const input = z
    .object({
      campaignId: z.string().uuid(),
      phone: phoneSchema,
      label: z.string().trim().min(2).max(100),
      confirmRegistration: z.literal(true),
    })
    .strict()
    .parse(raw);
  const account = process.env.TWILIO_ACCOUNT_SID,
    token = process.env.TWILIO_AUTH_TOKEN,
    service = process.env.TWILIO_MESSAGING_SERVICE_SID;
  if (!account || !token || !service)
    fail("Twilio credentials are not configured.");
  const response = await fetch(
    `https://messaging.twilio.com/v1/Services/${service}/PhoneNumbers?PageSize=1000`,
    {
      headers: {
        Authorization: `Basic ${Buffer.from(`${account}:${token}`).toString("base64")}`,
      },
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!response.ok) fail("Unable to verify the Twilio sender pool.");
  const result = await response.json();
  const number = result.phone_numbers?.find(
    (p: { phone_number: string; capabilities: string[] }) =>
      p.phone_number === input.phone && p.capabilities?.includes("SMS"),
  );
  if (!number)
    fail(
      "Number must belong to the configured Twilio Messaging Service and support SMS. If your pool exceeds 1,000 numbers, contact your administrator.",
    );
  return db.$transaction(async (tx) => {
    await queueLock(tx);
    const campaign = await tx.campaign.findUniqueOrThrow({
      where: { id: input.campaignId },
    });
    if (
      process.env.OUTREACH_CUSTOMER_ID &&
      process.env.OUTREACH_CUSTOMER_ID !== campaign.customerId
    )
      fail("This Twilio account is configured for another customer.");
    const existing = await tx.smsSender.findUnique({
      where: { phone: input.phone },
    });
    if (existing && existing.customerId !== campaign.customerId)
      fail("This number is assigned to another customer.");
    const sender = await tx.smsSender.upsert({
      where: { phone: input.phone },
      create: {
        phone: input.phone,
        label: input.label,
        customerId: campaign.customerId,
        serviceSid: service!,
        verifiedAt: new Date(),
      },
      update: {
        label: input.label,
        serviceSid: service!,
        verifiedAt: new Date(),
        active: true,
      },
    });
    await audit(tx, campaign.id, "sender_registered", actor, {
      senderId: sender.id,
    });
    return sender.id;
  });
}
export async function assignSender(raw: unknown, actor: string) {
  const input = z
    .object({
      campaignId: z.string().uuid(),
      senderId: z.string().uuid().nullable(),
    })
    .strict()
    .parse(raw);
  return db.$transaction(async (tx) => {
    await queueLock(tx);
    const campaign = await tx.campaign.findUniqueOrThrow({
      where: { id: input.campaignId },
    });
    if (
      await tx.outboundBatch.count({
        where: {
          campaignId: campaign.id,
          channel: "SMS",
          status: { not: "DRAFT" },
        },
      })
    )
      fail(
        "Sender is locked after approval. Create a new campaign to change it.",
      );
    const sender = input.senderId
      ? await tx.smsSender.findUnique({ where: { id: input.senderId } })
      : null;
    if (
      input.senderId &&
      (!sender ||
        !sender.active ||
        sender.customerId !== campaign.customerId ||
        sender.serviceSid !== process.env.TWILIO_MESSAGING_SERVICE_SID)
    )
      fail(
        "Choose an active sender belonging to this customer and Messaging Service.",
      );
    await tx.campaign.update({
      where: { id: campaign.id },
      data: { smsSenderId: input.senderId },
    });
    await audit(tx, campaign.id, "sender_assigned", actor, {
      senderId: input.senderId,
    });
  });
}
