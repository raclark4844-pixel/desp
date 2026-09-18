import { receiveSms, receiveEmail } from "../inbox/receive";
import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "../db";
import { queueLock, audit } from "./service";
import { xmlEscape, setupReasons, sendingWindow } from "./policy";
import { evaluateReadinessInTransaction } from "../compliance/service";
import type { Prisma } from "../../generated/prisma/client";
const equal = (a: string, b: string) => {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
export async function boundedText(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 262144) {
      await reader.cancel();
      throw new Error("BODY_TOO_LARGE");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
export function validTwilio(
  url: string,
  params: URLSearchParams,
  signature: string,
  token = process.env.TWILIO_AUTH_TOKEN,
) {
  if (!token || !signature) return false;
  const keys = [...new Set(params.keys())].sort();
  if (keys.some((k) => params.getAll(k).length !== 1)) return false;
  const expected = createHmac("sha1", token)
    .update(url + keys.map((k) => k + params.get(k)).join(""))
    .digest("base64");
  return equal(expected, signature);
}
export function validResend(
  body: string,
  headers: Headers,
  secret = process.env.RESEND_WEBHOOK_SECRET,
  now = Date.now(),
) {
  const id = headers.get("svix-id"),
    timestamp = headers.get("svix-timestamp"),
    signatures = headers.get("svix-signature");
  if (
    !secret ||
    !id ||
    !timestamp ||
    !signatures ||
    !/^\d+$/.test(timestamp) ||
    Math.abs(now - Number(timestamp) * 1000) > 300000
  )
    return false;
  const expected = createHmac(
    "sha256",
    Buffer.from(secret.replace(/^whsec_/, ""), "base64"),
  )
    .update(`${id}.${timestamp}.${body}`)
    .digest("base64");
  return signatures
    .split(" ")
    .some((s) => s.startsWith("v1,") && equal(expected, s.slice(3)));
}
async function suppress(
  tx: Prisma.TransactionClient,
  customerId: string,
  destination: string,
  reason: "OPT_OUT" | "COMPLAINT" | "INVALID_CONTACT" | "INTERNAL",
) {
  if (
    !(await tx.suppression.findFirst({
      where: {
        scope: "CUSTOMER",
        customerId,
        value: destination,
        reason,
        expiresAt: null,
      },
    }))
  )
    await tx.suppression.create({
      data: { scope: "CUSTOMER", customerId, value: destination, reason },
    });
  const contacts = await tx.contact.findMany({
    where: { normalizedValue: destination, lead: { customerId } },
    select: { leadId: true },
  });
  for (const contact of contacts)
    if (
      !(await tx.suppression.findFirst({
        where: {
          scope: "CUSTOMER",
          customerId,
          leadId: contact.leadId,
          reason,
          expiresAt: null,
        },
      }))
    )
      await tx.suppression.create({
        data: { scope: "CUSTOMER", customerId, leadId: contact.leadId, reason },
      });
}
export async function unsubscribe(token: string) {
  if (!/^[a-f0-9-]{36}$/i.test(token)) return false;
  return db.$transaction(async (tx) => {
    await queueLock(tx);
    const r = await tx.outboundRecipient.findUnique({
      where: { unsubscribeToken: token },
      include: { batch: { include: { campaign: true } } },
    });
    if (!r || r.batch.channel !== "EMAIL") return false;
    await suppress(tx, r.batch.campaign.customerId, r.destination, "OPT_OUT");
    await audit(tx, r.batch.campaignId, "unsubscribe", "recipient", {
      recipientId: r.id,
    });
    return true;
  });
}
const xml = (value: string) =>
  new Response(
    `<?xml version="1.0" encoding="UTF-8"?><Response>${value}</Response>`,
    { headers: { "Content-Type": "text/xml", "Cache-Control": "no-store" } },
  );
export async function twilioWebhook(request: Request) {
  const url = new URL(request.url);
  const base = process.env.OUTREACH_PUBLIC_URL;
  const params = new URLSearchParams(await boundedText(request));
  if (
    !base ||
    !validTwilio(
      base + url.pathname + url.search,
      params,
      request.headers.get("x-twilio-signature") ?? "",
    ) ||
    params.get("AccountSid") !== process.env.TWILIO_ACCOUNT_SID
  )
    return new Response("Unauthorized", { status: 401 });
  const action = url.searchParams.get("action");
  if (action === "inbound") {
    await receiveSms(params);
    return xml("");
  }
  const replyId = url.searchParams.get("reply");
  if (replyId) {
    if (!/^[a-f0-9-]{36}$/i.test(replyId))
      return new Response("Not found", { status: 404 });
    return db.$transaction(async (tx) => {
      await queueLock(tx);
      const reply = await tx.inboxReply.findUnique({
        where: { id: replyId },
        include: { conversation: { include: { contact: true } } },
      });
      const sid = params.get("MessageSid");
      if (
        !reply ||
        reply.status === "DRAFT" ||
        !sid ||
        reply.conversation.channel !== "SMS" ||
        params.get("To") !== reply.conversation.contact.normalizedValue ||
        params.get("From") !== reply.conversation.fromNumber ||
        (reply.providerId && reply.providerId !== sid)
      )
        return new Response("Mismatch", { status: 400 });
      const state = params.get("MessageStatus");
      const status =
        state === "delivered"
          ? "DELIVERED"
          : ["failed", "undelivered"].includes(state ?? "")
            ? "FAILED"
            : null;
      if (status && !["DELIVERED", "FAILED"].includes(reply.status)) {
        await tx.inboxReply.update({
          where: { id: reply.id },
          data: { status, providerId: sid },
        });
        if (reply.messageId)
          await tx.message.update({
            where: { id: reply.messageId },
            data: { status: status === "DELIVERED" ? "DELIVERED" : "FAILED" },
          });
      }
      return xml("");
    });
  }

  const id = url.searchParams.get("id") ?? "";
  if (!/^[a-f0-9-]{36}$/i.test(id))
    return new Response("Not found", { status: 404 });
  return db.$transaction(
    async (tx) => {
      await queueLock(tx);
      const r = await tx.outboundRecipient.findUnique({
        where: { id },
        include: { batch: { include: { campaign: true } } },
      });
      if (!r || !r.attemptedAt || r.batch.channel === "EMAIL")
        return new Response("Not found", { status: 404 });
      const sid = params.get(
        r.batch.channel === "SMS" ? "MessageSid" : "CallSid",
      );
      if (!sid || (r.providerId && r.providerId !== sid))
        return new Response("Mismatch", { status: 400 });
      if (
        params.get("To") !==
        (r.batch.channel === "SMS"
          ? r.destination
          : process.env.OUTREACH_AGENT_PHONE)
      )
        return new Response("Mismatch", { status: 400 });
      if (!r.providerId)
        await tx.outboundRecipient.update({
          where: { id },
          data: { providerId: sid },
        });
      if (action === "voice" || action === "bridge") {
        if (
          r.batch.channel !== "CALL" ||
          !["SENDING", "ACCEPTED"].includes(r.status) ||
          !["RUNNING", "QUEUED"].includes(r.batch.status) ||
          r.bridgeStartedAt
        )
          return xml("<Hangup/>");
        if (
          setupReasons("CALL", r.batch.campaign.customerId).length ||
          !sendingWindow(r.batch.recipientTimezone)
        )
          return xml("<Hangup/>");
        if (action === "voice")
          return xml(
            `<Gather numDigits="1" timeout="15" action="${xmlEscape(`${base}/api/outreach/twilio?id=${id}&action=bridge`)}" method="POST"><Say>AP Spartan campaign call. Review the approved script in your workspace. Press 1 when you are ready to speak to the prospect.</Say></Gather><Hangup/>`,
          );
        if (params.get("Digits") !== "1") return xml("<Hangup/>");
        const review = await evaluateReadinessInTransaction(tx, {
          campaignId: r.batch.campaignId,
          leadId: r.leadId,
          contactId: r.contactId,
          channel: "CALL",
        });
        const contact = await tx.contact.findUniqueOrThrow({
          where: { id: r.contactId },
        });
        if (review.reasons.length || contact.normalizedValue !== r.destination)
          return xml("<Say>This contact is no longer eligible.</Say><Hangup/>");
        await tx.outboundRecipient.update({
          where: { id },
          data: { bridgeStartedAt: new Date() },
        });
        await audit(
          tx,
          r.batch.campaignId,
          "call_bridge_started",
          "employee-phone",
          { recipientId: id },
        );
        return xml(
          `<Dial callerId="${xmlEscape(process.env.TWILIO_VOICE_FROM!)}" timeout="20" timeLimit="1800" action="${xmlEscape(`${base}/api/outreach/twilio?id=${id}&action=call-result`)}" method="POST"><Number>${xmlEscape(r.destination)}</Number></Dial><Hangup/>`,
        );
      }
      let status: string | undefined;
      if (action === "call-result" && r.batch.channel === "CALL")
        status =
          params.get("DialCallStatus") === "completed" ? "COMPLETED" : "FAILED";
      else if (action === "status") {
        const providerStatus = params.get(
          r.batch.channel === "SMS" ? "MessageStatus" : "CallStatus",
        );
        if (r.batch.channel === "SMS" && providerStatus === "delivered")
          status = "DELIVERED";
        else if (
          ["failed", "undelivered", "busy", "no-answer", "canceled"].includes(
            providerStatus ?? "",
          )
        )
          status = "FAILED";
        else if (
          r.batch.channel === "CALL" &&
          providerStatus === "completed" &&
          !r.bridgeStartedAt
        )
          status = "FAILED";
      }
      if (
        status &&
        !["DELIVERED", "COMPLETED", "FAILED", "CANCELLED"].includes(r.status)
      ) {
        await tx.outboundRecipient.update({
          where: { id },
          data: {
            status,
            reason: status === "FAILED" ? "PROVIDER_DELIVERY_FAILED" : null,
          },
        });
        if (status === "FAILED")
          await tx.outboundBatch.updateMany({
            where: { id: r.batchId, status: { not: "CANCELLED" } },
            data: { status: "REVIEW", reason: "PROVIDER_DELIVERY_FAILED" },
          });
        if (r.messageId)
          await tx.message.update({
            where: { id: r.messageId },
            data: { status: status === "FAILED" ? "FAILED" : "DELIVERED" },
          });
        await audit(tx, r.batch.campaignId, "delivery_updated", "twilio", {
          recipientId: id,
          status,
        });
      }
      return xml("");
    },
    { timeout: 30000 },
  );
}
export async function resendWebhook(request: Request) {
  const body = await boundedText(request);
  if (!validResend(body, request.headers))
    return new Response("Unauthorized", { status: 401 });
  let event;
  try {
    event = JSON.parse(body);
  } catch {
    return new Response("Invalid event", { status: 400 });
  }
  if (event.type === "email.received") {
    await receiveEmail(event);
    return new Response("OK");
  }
  const type = event.type,
    providerId = event.data?.email_id;
  if (typeof providerId !== "string") return new Response("Ignored");
  return db.$transaction(async (tx) => {
    await queueLock(tx);
    const invoice = await tx.billingInvoice.findUnique({
      where: { providerId },
    });
    if (invoice) {
      const bad = [
        "email.bounced",
        "email.complained",
        "email.failed",
        "email.suppressed",
      ].includes(type);
      if (bad) {
        await tx.billingInvoice.update({
          where: { id: invoice.id },
          data: { status: "FAILED", reason: type },
        });
        await tx.billingPreference.upsert({
          where: { customerId: invoice.customerId },
          create: { customerId: invoice.customerId, enabled: false },
          update: { enabled: false },
        });
      } else if (type === "email.delivered" && invoice.status !== "FAILED")
        await tx.billingInvoice.update({
          where: { id: invoice.id },
          data: { status: "DELIVERED" },
        });
      return new Response("OK");
    }
    const reply = await tx.inboxReply.findUnique({
      where: { providerId },
      include: { conversation: { include: { campaign: true, contact: true } } },
    });
    if (reply && reply.conversation.channel === "EMAIL") {
      const bad = [
        "email.bounced",
        "email.complained",
        "email.failed",
        "email.suppressed",
      ].includes(type);
      if (bad || type === "email.delivered") {
        if (bad)
          await suppress(
            tx,
            reply.conversation.campaign.customerId,
            reply.conversation.contact.normalizedValue,
            type === "email.complained" ? "COMPLAINT" : "INVALID_CONTACT",
          );
        if (reply.status !== "FAILED") {
          await tx.inboxReply.update({
            where: { id: reply.id },
            data: { status: bad ? "FAILED" : "DELIVERED" },
          });
          if (reply.messageId)
            await tx.message.update({
              where: { id: reply.messageId },
              data: { status: bad ? "FAILED" : "DELIVERED" },
            });
        }
      }
      return new Response("OK");
    }
    const r = await tx.outboundRecipient.findUnique({
      where: { providerId },
      include: { batch: { include: { campaign: true } } },
    });
    // A callback can beat the API response. 503 asks the provider to retry it.
    if (!r) return new Response("Awaiting send receipt", { status: 503 });
    if (r.batch.channel !== "EMAIL")
      return new Response("Mismatch", { status: 400 });
    const bad = [
      "email.bounced",
      "email.complained",
      "email.failed",
      "email.suppressed",
    ].includes(type);
    if (
      type === "email.bounced" ||
      type === "email.complained" ||
      type === "email.suppressed"
    )
      await suppress(
        tx,
        r.batch.campaign.customerId,
        r.destination,
        type === "email.complained" ? "COMPLAINT" : "INVALID_CONTACT",
      );
    if (
      bad ||
      (type === "email.delivered" &&
        !["FAILED", "CANCELLED"].includes(r.status))
    ) {
      const status = bad ? "FAILED" : "DELIVERED";
      if (bad)
        await tx.outboundBatch.updateMany({
          where: { id: r.batchId, status: { not: "CANCELLED" } },
          data: { status: "REVIEW", reason: "PROVIDER_DELIVERY_FAILED" },
        });
      if (r.status !== status) {
        await tx.outboundRecipient.update({
          where: { id: r.id },
          data: { status, reason: bad ? "PROVIDER_DELIVERY_FAILED" : null },
        });
        if (r.messageId)
          await tx.message.update({
            where: { id: r.messageId },
            data: { status: bad ? "FAILED" : "DELIVERED" },
          });
        await audit(tx, r.batch.campaignId, "delivery_updated", "resend", {
          recipientId: r.id,
          status,
        });
      }
    }
    return new Response("OK");
  });
}

export async function suppressRecipient(id: string, actorId: string) {
  return db.$transaction(async (tx) => {
    await queueLock(tx);
    const r = await tx.outboundRecipient.findUniqueOrThrow({
      where: { id },
      include: { batch: { include: { campaign: true } } },
    });
    await suppress(tx, r.batch.campaign.customerId, r.destination, "OPT_OUT");
    await audit(tx, r.batch.campaignId, "employee_recorded_opt_out", actorId, {
      recipientId: id,
    });
  });
}
