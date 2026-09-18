import { db } from "../db";
import { queueLock, audit } from "../outreach/service";
import type { Prisma } from "../../generated/prisma/client";
export const isStop = (body: string) =>
  /\b(stop|stopall|unsubscribe|cancel|end|quit|revoke|opt[ -]?out|don.t (text|contact)|remove me)\b/i.test(
    body,
  );
export async function persistInbound(
  tx: Prisma.TransactionClient,
  input: {
    key: string;
    channel: "SMS" | "EMAIL";
    sender: string;
    destination: string;
    body: string;
    conversationId?: string;
    stop?: boolean;
    reason?: string;
  },
) {
  if (await tx.inboxReceipt.findUnique({ where: { key: input.key } })) return;
  const c = input.conversationId
    ? await tx.conversation.findUnique({
        where: { id: input.conversationId },
        include: { campaign: true },
      })
    : null;
  await tx.inboxReceipt.create({
    data: {
      key: input.key,
      channel: input.channel,
      sender: input.sender,
      destination: input.destination,
      body: input.body.slice(0, 20000),
      conversationId: c?.id,
      reason: input.reason ?? (c ? null : "UNMATCHED"),
    },
  });
  if (!c) return;
  await tx.message.create({
    data: {
      conversationId: c.id,
      contactId: c.contactId,
      provider: input.channel === "SMS" ? "twilio" : "resend",
      providerMessageId: input.key,
      direction: "INBOUND",
      status: "RECEIVED",
      body: input.body.slice(0, 20000),
      receivedAt: new Date(),
    },
  });
  await tx.conversation.update({
    where: { id: c.id },
    data: { needsReply: true, campaignHold: true, status: "ESCALATED" },
  });
  if (input.stop)
    await tx.suppression.create({
      data: {
        scope: "CUSTOMER",
        customerId: c.campaign.customerId,
        value: input.sender,
        reason: "OPT_OUT",
      },
    });
  const targets = await tx.notificationTarget.findMany({
    where: { campaignId: c.campaignId, enabled: true },
  });
  if (targets.length)
    await tx.replyNotification.createMany({
      data: targets.map((t) => ({
        targetId: t.id,
        receiptKey: input.key,
        conversationId: c.id,
      })),
      skipDuplicates: true,
    });
  await audit(
    tx,
    c.campaignId,
    input.stop ? "inbox_opt_out" : "inbox_received",
    "provider",
    { conversationId: c.id, receiptKey: input.key },
  );
}
export async function receiveSms(params: URLSearchParams) {
  const from = params.get("From") ?? "",
    to = params.get("To") ?? "",
    sid = params.get("MessageSid") ?? "";
  if (
    !/^\+1\d{10}$/.test(from) ||
    !/^\+1\d{10}$/.test(to) ||
    !/^SM[a-f0-9]{32}$/i.test(sid)
  )
    return;
  const body = params.get("Body") ?? "",
    stop = params.get("OptOutType") === "STOP" || isStop(body);
  return db.$transaction(async (tx) => {
    await queueLock(tx);
    // Match BOTH sides of the phone pair. Never attach a reply to a draft or guess among campaigns.
    const candidates = await tx.conversation.findMany({
      where: {
        channel: "SMS",
        fromNumber: to,
        contact: { normalizedValue: from },
        messages: { some: { direction: "OUTBOUND" } },
      },
      take: 2,
    });
    await persistInbound(tx, {
      key: `twilio:${sid}`,
      channel: "SMS",
      sender: from,
      destination: to,
      body,
      conversationId: candidates.length === 1 ? candidates[0].id : undefined,
      stop,
      reason: candidates.length > 1 ? "AMBIGUOUS_CAMPAIGN" : undefined,
    });
    // Unmatched STOP still suppresses the destination for the sender's customer.
    if (stop && candidates.length !== 1) {
      const sender = await tx.smsSender.findUnique({ where: { phone: to } });
      if (
        sender &&
        !(await tx.suppression.findFirst({
          where: {
            customerId: sender.customerId,
            value: from,
            reason: "OPT_OUT",
            expiresAt: null,
          },
        }))
      )
        await tx.suppression.create({
          data: {
            scope: "CUSTOMER",
            customerId: sender.customerId,
            value: from,
            reason: "OPT_OUT",
          },
        });
    }
    if (stop)
      await tx.notificationTarget.updateMany({
        where: { channel: "SMS", destination: from },
        data: { enabled: false },
      });
  });
}
export async function receiveEmail(event: { data?: { email_id?: unknown } }) {
  const id = event.data?.email_id;
  if (typeof id !== "string" || !/^[a-f0-9-]{36}$/i.test(id)) return;
  if (await db.inboxReceipt.findUnique({ where: { key: `resend:${id}` } }))
    return;
  if (!process.env.RESEND_API_KEY || !process.env.INBOX_EMAIL_DOMAIN)
    throw new Error("Receiving not configured");
  const response = await fetch(
    `https://api.resend.com/emails/receiving/${id}`,
    {
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!response.ok) throw new Error("Email retrieval unavailable");
  const email = await response.json();
  const from =
    String(email.from ?? "").match(/<([^>]+)>/)?.[1] ??
    String(email.from ?? "");
  const addresses = Array.isArray(email.to) ? email.to : [];
  const tokens = addresses
    .filter((a: unknown) => typeof a === "string")
    .map((a: string) => a.toLowerCase())
    .filter((a: string) =>
      a.endsWith(`@${process.env.INBOX_EMAIL_DOMAIN!.toLowerCase()}`),
    )
    .map((a: string) => a.match(/^reply\+([a-f0-9-]{36})@/)?.[1])
    .filter(Boolean);
  await db.$transaction(async (tx) => {
    await queueLock(tx);
    const c =
      tokens.length === 1
        ? await tx.conversation.findUnique({
            where: { replyToken: tokens[0] },
            include: { contact: true },
          })
        : null;
    const match =
      c?.channel === "EMAIL" &&
      c.contact.normalizedValue.toLowerCase() === from.toLowerCase();
    await persistInbound(tx, {
      key: `resend:${id}`,
      channel: "EMAIL",
      sender: from.toLowerCase(),
      destination: addresses.join(", ").slice(0, 1000),
      body:
        typeof email.text === "string"
          ? email.text
          : "[No plain-text body. Review in email provider; attachments are not opened.]",
      conversationId: match ? c.id : undefined,
      stop: typeof email.text === "string" && isStop(email.text),
    });
  });
}
