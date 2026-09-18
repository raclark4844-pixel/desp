import { db } from "../db";
import { queueLock } from "../outreach/service";
// One claimed notification per run. Ambiguous sends are never automatically retried.
export async function dispatchNotification() {
  if (
    process.env.VERCEL_ENV !== "production" ||
    process.env.INBOX_NOTIFICATIONS_ENABLED !== "true"
  )
    return "NOTIFICATIONS_DISABLED";
  const readyChannels: string[] = [];
  if (
    process.env.INBOX_EMAIL_NOTIFICATIONS_VERIFIED === "true" &&
    process.env.RESEND_API_KEY &&
    process.env.INBOX_NOTIFICATION_FROM
  )
    readyChannels.push("EMAIL");
  if (
    process.env.INBOX_SMS_NOTIFICATIONS_VERIFIED === "true" &&
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.INBOX_NOTIFICATION_SMS_FROM
  )
    readyChannels.push("SMS");
  const work = await db.$transaction(async (tx) => {
    await queueLock(tx);
    await tx.replyNotification.updateMany({
      where: {
        status: "SENDING",
        updatedAt: { lt: new Date(Date.now() - 120000) },
      },
      data: {
        status: "UNKNOWN",
        reason: "Delivery result unknown; review provider.",
      },
    });
    const recent = await tx.replyNotification.findMany({
      where: {
        status: { in: ["SENDING", "SENT"] },
        updatedAt: { gt: new Date(Date.now() - 60000) },
      },
      select: { targetId: true },
    });
    const job = await tx.replyNotification.findFirst({
      where: {
        status: "PENDING",
        target: { channel: { in: readyChannels } },
        targetId: { notIn: recent.map((n) => n.targetId) },
      },
      orderBy: { createdAt: "asc" },
      include: { target: true },
    });
    if (!job) return null;
    const employee = await tx.employee.findFirst({
      where: { id: job.target.employeeId, isActive: true },
    });
    if (
      !job.target.enabled ||
      !employee ||
      (job.target.channel === "EMAIL" &&
        employee.email.toLowerCase() !== job.target.destination.toLowerCase())
    ) {
      await tx.replyNotification.update({
        where: { id: job.id },
        data: { status: "CANCELLED" },
      });
      return null;
    }
    if (job.kind === "HANDOFF") {
      const campaign = await tx.campaign.findUnique({
        where: { id: job.target.campaignId },
      });
      if (
        job.destinationSnapshot !== job.target.destination ||
        campaign?.primaryAlertTargetId !== job.targetId
      ) {
        await tx.replyNotification.update({
          where: { id: job.id },
          data: {
            status: "CANCELLED",
            reason: "Primary contact changed after review.",
          },
        });
        return null;
      }
    }
    const email = job.target.channel === "EMAIL";
    const ready = email
      ? process.env.INBOX_EMAIL_NOTIFICATIONS_VERIFIED === "true" &&
        process.env.RESEND_API_KEY &&
        process.env.INBOX_NOTIFICATION_FROM
      : process.env.INBOX_SMS_NOTIFICATIONS_VERIFIED === "true" &&
        process.env.TWILIO_ACCOUNT_SID &&
        process.env.TWILIO_AUTH_TOKEN &&
        process.env.INBOX_NOTIFICATION_SMS_FROM;
    if (!ready) return null;
    if (
      await tx.replyNotification.count({
        where: {
          targetId: job.targetId,
          status: { in: ["SENDING", "SENT"] },
          updatedAt: { gt: new Date(Date.now() - 60000) },
        },
      })
    )
      return null;
    await tx.replyNotification.update({
      where: { id: job.id },
      data: { status: "SENDING" },
    });
    return job;
  });
  if (!work) return "NO_NOTIFICATION_READY";
  try {
    const base = process.env.OUTREACH_PUBLIC_URL;
    if (!base || !/^https:\/\/[^/]+$/.test(base))
      throw new Error("Public URL missing");
    const text =
      work.kind === "HANDOFF"
        ? `AP Spartan employee handoff: ${work.body ?? "A campaign contact wants to proceed."}\nReview: ${base}/inbox?conversation=${work.conversationId}`
        : `AP Spartan: A campaign contact replied. Sign in to review: ${base}/inbox?conversation=${work.conversationId}`;
    const email = work.target.channel === "EMAIL";
    const response = email
      ? await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
            "Idempotency-Key": `notification-${work.id}`,
          },
          body: JSON.stringify({
            from: process.env.INBOX_NOTIFICATION_FROM,
            to: [work.target.destination],
            subject: "AP Spartan — new campaign reply",
            text,
          }),
          signal: AbortSignal.timeout(15000),
        })
      : await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`,
          {
            method: "POST",
            headers: {
              Authorization: `Basic ${Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64")}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
              To: work.target.destination,
              From: process.env.INBOX_NOTIFICATION_SMS_FROM!,
              Body: text + " Reply STOP to stop alerts.",
              ValidityPeriod: "300",
            }),
            signal: AbortSignal.timeout(15000),
          },
        );
    if (!response.ok) {
      await db.replyNotification.update({
        where: { id: work.id },
        data: {
          status: response.status >= 500 ? "UNKNOWN" : "FAILED",
          reason: `Provider status ${response.status}`,
        },
      });
      return "NOTIFICATION_FAILED";
    }
    const result = await response.json();
    const providerId = email ? result.id : result.sid;
    if (typeof providerId !== "string") throw new Error("Missing receipt");
    await db.replyNotification.update({
      where: { id: work.id },
      data: { status: "SENT", providerId },
    });
    return "NOTIFICATION_ACCEPTED";
  } catch {
    await db.replyNotification.update({
      where: { id: work.id },
      data: { status: "UNKNOWN", reason: "Check provider before resending." },
    });
    return "NOTIFICATION_UNKNOWN";
  }
}
