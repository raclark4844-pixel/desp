import { z } from "zod";
import { db } from "../db";
import { queueLock, audit } from "../outreach/service";
import { fail, phoneSchema } from "./senders";
import { isStop } from "./receive";
const line = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((v) => !/[\r\n]/.test(v), "Use a single line.");
const fieldsSchema = z
  .object({
    name: line(120).pipe(z.string().min(2)),
    address: line(250).pipe(z.string().min(3)),
    phone: phoneSchema,
    email: z.union([z.literal(""), z.email().max(254)]),
    service: line(200).pipe(z.string().min(2)),
  })
  .strict();
export async function setPrimaryContact(raw: unknown, actor: string) {
  const input = z
    .object({
      campaignId: z.string().uuid(),
      name: line(120).pipe(z.string().min(2)),
      phone: phoneSchema,
      confirm: z.literal(true),
    })
    .strict()
    .parse(raw);
  return db.$transaction(async (tx) => {
    await queueLock(tx);
    const c = await tx.campaign.findUniqueOrThrow({
      where: { id: input.campaignId },
    });
    // A new immutable recipient is used for each change. Previously reviewed deliveries are never rerouted.
    const target = await tx.notificationTarget.create({
      data: {
        campaignId: c.id,
        kind: "CUSTOMER",
        name: input.name,
        channel: "SMS",
        destination: input.phone,
        confirmedAt: new Date(),
      },
    });
    if (c.primaryAlertTargetId)
      await tx.notificationTarget.updateMany({
        where: { id: c.primaryAlertTargetId, kind: "CUSTOMER" },
        data: { enabled: false },
      });
    await tx.campaign.update({
      where: { id: c.id },
      data: { primaryAlertTargetId: target.id },
    });
    await audit(tx, c.id, "campaign_customer_contact_saved", actor, {
      targetId: target.id,
      confirmedPermission: true,
    });
  });
}
export function leadText(campaign: string, f: z.infer<typeof fieldsSchema>) {
  return `AP Spartan — qualified lead\nCampaign: ${campaign}\nName: ${f.name}\nAddress: ${f.address}\nPhone: ${f.phone}\nEmail: ${f.email || "Not provided"}\nService requested: ${f.service}\nThe prospect agreed to be contacted about this service.`;
}
export async function handoffPreview(conversationId: string) {
  const c = await db.conversation.findUniqueOrThrow({
    where: { id: conversationId },
    include: {
      campaign: true,
      contact: true,
      lead: {
        include: {
          properties: { orderBy: { createdAt: "asc" }, take: 1 },
          contacts: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
        },
      },
      qualifications: { orderBy: { createdAt: "desc" }, take: 1 },
      messages: {
        where: { direction: "INBOUND" },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
      },
    },
  });
  const t = c.campaign.primaryAlertTargetId
    ? await db.notificationTarget.findUnique({
        where: { id: c.campaign.primaryAlertTargetId },
      })
    : null;
  const p = c.lead.properties[0];
  const answers = c.qualifications[0]?.answers as
    Record<string, unknown> | undefined;
  const service =
    typeof answers?.serviceRequested === "string"
      ? answers.serviceRequested
      : typeof answers?.service === "string"
        ? answers.service
        : "";
  const phone = ["MOBILE", "LANDLINE"].includes(c.contact.type)
    ? c.contact.normalizedValue
    : (c.lead.contacts.find(
        (t) => ["MOBILE", "LANDLINE"].includes(t.type) && t.isValid !== false,
      )?.normalizedValue ?? "");
  return {
    target:
      t?.kind === "CUSTOMER" && t.enabled && t.campaignId === c.campaignId
        ? { id: t.id, name: t.name ?? "Campaign contact", phone: t.destination }
        : null,
    sourceMessageId: c.messages[0]?.id ?? null,
    fields: {
      name:
        [c.lead.firstName, c.lead.lastName].filter(Boolean).join(" ") ||
        c.lead.companyName ||
        "",
      address: p
        ? [p.address1, p.address2, p.city, p.state, p.postalCode]
            .filter(Boolean)
            .join(", ")
        : "",
      phone,
      email:
        c.lead.contacts.find((t) => t.type === "EMAIL" && t.isValid !== false)
          ?.normalizedValue ?? "",
      service,
    },
    alerts: await db.replyNotification.findMany({
      where: { conversationId: c.id, kind: "LEAD_HANDOFF" },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, status: true, body: true, createdAt: true },
    }),
  };
}
export async function queueHandoff(raw: unknown, actor: string) {
  const input = z
    .object({
      conversationId: z.string().uuid(),
      targetId: z.string().uuid(),
      sourceMessageId: z.string().uuid(),
      expectedPhone: z.string(),
      fields: fieldsSchema,
      confirm: z.literal(true),
    })
    .strict()
    .parse(raw);
  return db.$transaction(async (tx) => {
    await queueLock(tx);
    const c = await tx.conversation.findUniqueOrThrow({
      where: { id: input.conversationId },
      include: { campaign: { include: { customer: true } } },
    });
    if (c.campaign.customer.status !== "ACTIVE")
      fail("This customer is not active.");
    const message = await tx.message.findFirst({
      where: { conversationId: c.id, direction: "INBOUND" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    if (
      !message ||
      message.id !== input.sourceMessageId ||
      isStop(message.body)
    )
      fail(
        "Refresh and review the latest incoming response before sharing this lead.",
      );
    const target = await tx.notificationTarget.findUnique({
      where: { id: input.targetId },
    });
    if (
      !target ||
      target.kind !== "CUSTOMER" ||
      !target.enabled ||
      target.campaignId !== c.campaignId ||
      target.channel !== "SMS" ||
      target.destination !== input.expectedPhone ||
      c.campaign.primaryAlertTargetId !== target.id
    )
      fail(
        "The campaign main contact changed or is unavailable. Refresh and review the recipient.",
      );
    const receiptKey = `lead-handoff:${c.campaignId}:${c.leadId}`;
    const existing = await tx.replyNotification.findFirst({
      where: { receiptKey, kind: "LEAD_HANDOFF" },
    });
    if (existing)
      return { id: existing.id, status: existing.status, alreadyQueued: true };
    const alert = await tx.replyNotification.create({
      data: {
        targetId: target!.id,
        receiptKey,
        conversationId: c.id,
        kind: "LEAD_HANDOFF",
        body: leadText(c.campaign.name, input.fields),
        destinationSnapshot: target!.destination,
      },
    });
    await tx.conversation.update({
      where: { id: c.id },
      data: { status: "QUALIFIED", campaignHold: true },
    });
    await audit(tx, c.campaignId, "qualified_lead_shared", actor, {
      notificationId: alert.id,
      leadId: c.leadId,
      sourceMessageId: message!.id,
      targetId: target!.id,
      employeeConfirmedInterestAndSharing: true,
    });
    return { id: alert.id, status: alert.status, alreadyQueued: false };
  });
}
