import { db } from "../db";
import type { Prisma } from "../../generated/prisma/client";
import { SourceError, asRecord } from "../lead-sources/contract";
import { evaluateReadinessInTransaction } from "../compliance/service";
import {
  channels,
  draftSchema,
  controlSchema,
  reservationKey,
  sendingWindow,
  setupReasons,
} from "./policy";
import {
  deliveryAdapter,
  DeliveryError,
  type DeliveryAdapter,
} from "./provider";
export const queueLock = async (tx: Prisma.TransactionClient) => {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(728411901)`;
};
const fail = (message: string): never => {
  throw new SourceError(message, "failed");
};
export async function audit(
  tx: Prisma.TransactionClient,
  campaignId: string,
  eventType: string,
  actorId: string,
  payload: Prisma.InputJsonValue,
) {
  await tx.auditEvent.create({
    data: {
      campaignId,
      eventType: `outreach.${eventType}`,
      actorType: "OUTREACH",
      actorId,
      payload,
    },
  });
}
export async function createDraft(raw: unknown, actorId: string) {
  const input = draftSchema.parse(raw);
  return db.$transaction(async (tx) => {
    await queueLock(tx);
    const campaign = await tx.campaign.findUnique({
      where: { id: input.campaignId },
    });
    if (!campaign) fail("Campaign not found.");
    const requested = asRecord(
      asRecord(campaign!.outreachConfig).requestedChannels,
    );
    if (
      requested[
        input.channel === "SMS"
          ? "sms"
          : input.channel === "EMAIL"
            ? "email"
            : "calling"
      ] !== true
    )
      fail("Enable this channel in the campaign before preparing delivery.");
    const existing = await tx.outboundBatch.findUnique({
      where: {
        campaignId_channel: {
          campaignId: input.campaignId,
          channel: input.channel,
        },
      },
    });
    if (existing && existing.status !== "DRAFT")
      fail("An approved batch cannot be edited or duplicated.");
    const batch = await tx.outboundBatch.upsert({
      where: {
        campaignId_channel: {
          campaignId: input.campaignId,
          channel: input.channel,
        },
      },
      create: { ...input, createdBy: actorId },
      update: input,
    });
    await audit(tx, input.campaignId, "draft_saved", actorId, {
      batchId: batch.id,
      channel: batch.channel,
    });
    return batch.id;
  });
}
export async function controlBatch(raw: unknown, actorId: string) {
  const input = controlSchema.parse(raw);
  return db.$transaction(
    async (tx) => {
      await queueLock(tx);
      const batch = await tx.outboundBatch.findUnique({
        where: { id: input.id },
        include: { campaign: true },
      });
      if (!batch) fail("Batch not found.");
      const b = batch!;
      let status = b.status;
      if (input.action === "APPROVE") {
        if (b.status !== "DRAFT") return b.id;
        if (input.expectedUpdatedAt !== b.updatedAt.toISOString())
          fail("The draft changed. Refresh and review it again.");
        if (!input.confirmReview)
          fail(
            "Review the message, sender, audience timezone and consent before approving.",
          );
        const contacts = await tx.contact.findMany({
          where: {
            type:
              b.channel === "EMAIL"
                ? "EMAIL"
                : b.channel === "SMS"
                  ? "MOBILE"
                  : { in: ["MOBILE", "LANDLINE", "OTHER"] },
            lead: {
              customerId: b.campaign.customerId,
              campaignLeads: {
                some: { campaignId: b.campaignId, removedAt: null },
              },
            },
          },
          orderBy: [{ isPrimary: "desc" }, { id: "asc" }],
          take: 5001,
        });
        if (!contacts.length)
          fail("No matching contacts are enrolled in this campaign.");
        if (contacts.length > 5000)
          fail("Split this campaign into audiences of at most 5,000 contacts.");
        const leads = new Set<string>(),
          destinations = new Set<string>();
        for (const c of contacts) {
          if (leads.has(c.leadId) || destinations.has(c.normalizedValue))
            continue;
          leads.add(c.leadId);
          destinations.add(c.normalizedValue);
          await tx.outboundRecipient.create({
            data: {
              batchId: b.id,
              contactId: c.id,
              leadId: c.leadId,
              destination: c.normalizedValue,
            },
          });
        }
        status = "QUEUED";
        await tx.outboundBatch.update({
          where: { id: b.id },
          data: {
            status,
            approvedBy: actorId,
            approvedAt: new Date(),
            queuedAt: new Date(),
            reason: null,
          },
        });
      } else {
        if (["COMPLETED", "CANCELLED"].includes(b.status))
          fail("This batch is already closed.");
        if (input.action === "CANCEL") {
          status = "CANCELLED";
          await tx.outboundRecipient.updateMany({
            where: {
              batchId: b.id,
              status: { in: ["PENDING", "BLOCKED", "UNKNOWN"] },
            },
            data: { status: "CANCELLED", reason: "CANCELLED_BY_ADMIN" },
          });
        } else if (input.action === "PAUSE") {
          if (b.status === "DRAFT") fail("Approve the draft before pausing.");
          status = "PAUSED";
        } else {
          if (!["PAUSED", "REVIEW"].includes(b.status))
            fail("Only paused or review batches can resume.");
          if (
            await tx.outboundRecipient.count({
              where: { batchId: b.id, status: { in: ["UNKNOWN", "FAILED"] } },
            })
          )
            fail(
              "Resolve delivery failures or cancel this batch before continuing; uncertain sends are never retried.",
            );
          await tx.outboundRecipient.updateMany({
            where: { batchId: b.id, status: "BLOCKED" },
            data: { status: "PENDING", reason: null },
          });
          status = "QUEUED";
        }
        await tx.outboundBatch.update({
          where: { id: b.id },
          data: { status, reason: null },
        });
      }
      await audit(tx, b.campaignId, input.action.toLowerCase(), actorId, {
        batchId: b.id,
        status,
      });
      return b.id;
    },
    { timeout: 30000 },
  );
}
export async function sendingOverview() {
  const batches = await db.outboundBatch.findMany({
    orderBy: { position: "asc" },
    take: 200,
    include: {
      campaign: {
        select: {
          name: true,
          customerId: true,
          customer: { select: { name: true } },
        },
      },
      _count: { select: { recipients: true } },
    },
  });
  const counts = await db.outboundRecipient.groupBy({
    by: ["batchId", "status"],
    where: { batchId: { in: batches.map((b) => b.id) } },
    _count: true,
  });
  const issues = await db.outboundRecipient.findMany({
    where: {
      batchId: { in: batches.map((b) => b.id) },
      status: { in: ["BLOCKED", "FAILED", "UNKNOWN"] },
    },
    select: {
      id: true,
      batchId: true,
      reason: true,
      leadId: true,
      contactId: true,
    },
    take: 200,
  });
  const recentRecipients = await db.outboundRecipient.findMany({
    where: {
      batchId: { in: batches.map((b) => b.id) },
      attemptedAt: { not: null },
    },
    orderBy: { attemptedAt: "desc" },
    take: 100,
    select: {
      id: true,
      batchId: true,
      status: true,
      destination: true,
      contact: {
        select: {
          lead: {
            select: { firstName: true, lastName: true, companyName: true },
          },
        },
      },
    },
  });
  return {
    campaigns: await db.campaign.findMany({
      where: { status: { in: ["DRAFT", "READY", "RUNNING", "PAUSED"] } },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: { id: true, name: true, customer: { select: { name: true } } },
    }),
    batches: batches.map((b) => ({
      ...b,
      setup: setupReasons(b.channel, b.campaign.customerId),
      issues: issues.filter((r) => r.batchId === b.id),
      recentRecipients: recentRecipients
        .filter((r) => r.batchId === b.id)
        .map((r) => ({
          id: r.id,
          status: r.status,
          name:
            [r.contact.lead.firstName, r.contact.lead.lastName]
              .filter(Boolean)
              .join(" ") ||
            r.contact.lead.companyName ||
            "Prospect",
          contact:
            b.channel === "EMAIL"
              ? "Email address on file"
              : `Phone ending ${r.destination.slice(-4)}`,
        })),
      counts: counts
        .filter((c) => c.batchId === b.id)
        .map((c) => ({ status: c.status, count: c._count })),
    })),
    liveEnabled: process.env.OUTREACH_ENABLED === "true",
  };
}
export async function dispatchNext(adapter: DeliveryAdapter = deliveryAdapter) {
  // Persist SENDING before touching a provider. A crash can never return it to PENDING.
  const work = await db.$transaction(
    async (tx) => {
      await queueLock(tx);
      const outstanding = await tx.outboundRecipient.findFirst({
        where: { status: { in: ["SENDING", "ACCEPTED", "UNKNOWN"] } },
        include: { batch: true },
        orderBy: { createdAt: "asc" },
      });
      if (outstanding) {
        const limit = outstanding.status === "SENDING" ? 120000 : 86400000;
        if (
          outstanding.status !== "UNKNOWN" &&
          outstanding.attemptedAt &&
          Date.now() - +outstanding.attemptedAt > limit
        ) {
          await tx.outboundRecipient.update({
            where: { id: outstanding.id },
            data: {
              status: "UNKNOWN",
              reason: "DELIVERY_CONFIRMATION_REQUIRED",
            },
          });
          if (outstanding.batch.status !== "CANCELLED")
            await tx.outboundBatch.update({
              where: { id: outstanding.batchId },
              data: {
                status: "REVIEW",
                reason: "DELIVERY_CONFIRMATION_REQUIRED",
              },
            });
        }
        return { reason: "WAITING_FOR_DELIVERY_CONFIRMATION" } as const;
      }
      const head = await tx.outboundBatch.findFirst({
        where: { status: { in: ["QUEUED", "RUNNING", "PAUSED", "REVIEW"] } },
        orderBy: [{ queuedAt: "asc" }, { position: "asc" }],
      });
      if (!head) return { reason: "QUEUE_EMPTY" } as const;
      // All approved channels of the first campaign are processed SMS → email → call.
      const siblings = await tx.outboundBatch.findMany({
        where: {
          campaignId: head.campaignId,
          status: { in: ["QUEUED", "RUNNING", "PAUSED", "REVIEW"] },
        },
      });
      const batch = siblings.sort(
        (a, b) => channels.indexOf(a.channel) - channels.indexOf(b.channel),
      )[0];
      if (["PAUSED", "REVIEW"].includes(batch.status))
        return { reason: "QUEUE_PAUSED_FOR_REVIEW" } as const;
      const campaign = await tx.campaign.findUniqueOrThrow({
        where: { id: batch.campaignId },
        include: { customer: true },
      });
      const setup = setupReasons(batch.channel, campaign.customerId);
      if (setup.length) {
        await tx.outboundBatch.update({
          where: { id: batch.id },
          data: { reason: setup.join(", ") },
        });
        return { reason: setup[0] } as const;
      }
      if (!sendingWindow(batch.recipientTimezone))
        return { reason: "OUTSIDE_SENDING_HOURS" } as const;
      if (batch.lastDispatchAt && Date.now() - +batch.lastDispatchAt < 60000)
        return { reason: "RATE_LIMIT" } as const;
      const recipient = await tx.outboundRecipient.findFirst({
        where: { batchId: batch.id, status: "PENDING" },
        orderBy: { createdAt: "asc" },
        include: { contact: true },
      });
      if (!recipient) {
        const unresolved = await tx.outboundRecipient.count({
          where: {
            batchId: batch.id,
            status: { in: ["BLOCKED", "FAILED", "UNKNOWN"] },
          },
        });
        await tx.outboundBatch.update({
          where: { id: batch.id },
          data: {
            status: unresolved ? "REVIEW" : "COMPLETED",
            reason: unresolved ? "RECIPIENTS_REQUIRE_REVIEW" : null,
          },
        });
        return {
          reason: unresolved ? "REVIEW_REQUIRED" : "BATCH_COMPLETED",
        } as const;
      }
      if (recipient.nextAttemptAt && recipient.nextAttemptAt > new Date())
        return { reason: "RETRY_BACKOFF" } as const;
      const prior = await tx.outboundRecipient.findFirst({
        where: {
          id: { not: recipient.id },
          leadId: recipient.leadId,
          attemptedAt: { gt: new Date(Date.now() - 86400000) },
          status: { in: ["ACCEPTED", "DELIVERED", "COMPLETED"] },
        },
      });
      if (prior) return { reason: "RECIPIENT_24_HOUR_SPACING" } as const;
      const result = await evaluateReadinessInTransaction(tx, {
        campaignId: batch.campaignId,
        leadId: recipient.leadId,
        contactId: recipient.contactId,
        channel: batch.channel,
      });
      const key = reservationKey(
        campaign.customerId,
        batch.channel,
        recipient.destination,
      );
      const reservation = await tx.outboundReservation.findUnique({
        where: { key },
      });
      const reasons = [...result.reasons];
      if (recipient.contact.normalizedValue !== recipient.destination)
        reasons.push("CONTACT_CHANGED_AFTER_APPROVAL");
      if (reservation && reservation.recipientId !== recipient.id)
        reasons.push("ALREADY_CONTACTED_IN_ANOTHER_CAMPAIGN");
      if (reasons.length) {
        await tx.outboundRecipient.update({
          where: { id: recipient.id },
          data: {
            status:
              reservation && reservation.recipientId !== recipient.id
                ? "SKIPPED"
                : "BLOCKED",
            reason: reasons.join(", "),
          },
        });
        await audit(tx, batch.campaignId, "recipient_blocked", "worker", {
          batchId: batch.id,
          recipientId: recipient.id,
          reasons,
        });
        return { reason: "RECIPIENT_BLOCKED" } as const;
      }
      if (!reservation)
        await tx.outboundReservation.create({
          data: { key, recipientId: recipient.id },
        });
      await tx.outboundRecipient.update({
        where: { id: recipient.id },
        data: {
          status: "SENDING",
          attemptedAt: new Date(),
          attempts: { increment: 1 },
          reason: null,
        },
      });
      await tx.outboundBatch.update({
        where: { id: batch.id },
        data: { status: "RUNNING", lastDispatchAt: new Date(), reason: null },
      });
      await audit(tx, batch.campaignId, "dispatch_started", "worker", {
        batchId: batch.id,
        recipientId: recipient.id,
        channel: batch.channel,
      });
      return {
        input: {
          id: recipient.id,
          channel: batch.channel,
          destination: recipient.destination,
          subject: batch.subject,
          body: batch.body,
          senderName: campaign.customer.name,
          mailingAddress: batch.mailingAddress,
          unsubscribeToken: recipient.unsubscribeToken,
        },
        batch,
        recipient,
      } as const;
    },
    { timeout: 30000 },
  );
  if (!work.input || !work.batch || !work.recipient) return work;
  const { input, batch, recipient } = work;
  try {
    const providerId = await adapter.send(input);
    await db.$transaction(async (tx) => {
      await queueLock(tx);
      const current = await tx.outboundRecipient.findUniqueOrThrow({
        where: { id: recipient.id },
      });
      if (current.status === "SENDING")
        await tx.outboundRecipient.update({
          where: { id: current.id },
          data: { status: "ACCEPTED", providerId },
        });
      if (!current.messageId) {
        const conversation = await tx.conversation.create({
          data: {
            campaignId: batch.campaignId,
            leadId: current.leadId,
            contactId: current.contactId,
            channel: batch.channel,
          },
        });
        const message = await tx.message.create({
          data: {
            conversationId: conversation.id,
            contactId: current.contactId,
            provider: batch.channel === "EMAIL" ? "resend" : "twilio",
            providerMessageId: providerId,
            direction: "OUTBOUND",
            status:
              current.status === "FAILED"
                ? "FAILED"
                : ["DELIVERED", "COMPLETED"].includes(current.status)
                  ? "DELIVERED"
                  : batch.channel === "CALL"
                    ? "QUEUED"
                    : "SENT",
            body: batch.body,
            sentAt: new Date(),
            metadata: {
              recipientId: current.id,
              channel: batch.channel,
              deliveryStatus: "provider_accepted",
            },
          },
        });
        await tx.outboundRecipient.update({
          where: { id: current.id },
          data: { messageId: message.id },
        });
      }
      await audit(tx, batch.campaignId, "provider_accepted", "worker", {
        recipientId: current.id,
        providerId,
      });
    });
    return { reason: "PROVIDER_ACCEPTED" };
  } catch (e) {
    // A database error after provider acceptance is ambiguous too: never blindly retry.
    const kind = e instanceof DeliveryError ? e.kind : "UNKNOWN";
    await db.$transaction(async (tx) => {
      await queueLock(tx);
      const retry = kind === "RATE_LIMITED" && recipient.attempts < 2;
      const status = retry
        ? "PENDING"
        : kind === "UNKNOWN"
          ? "UNKNOWN"
          : "FAILED";
      const changed = await tx.outboundRecipient.updateMany({
        where: { id: recipient.id, status: "SENDING" },
        data: {
          status,
          reason: kind,
          nextAttemptAt: retry
            ? new Date(Date.now() + 60000 * 2 ** recipient.attempts)
            : null,
        },
      });
      if (changed.count && !retry)
        await tx.outboundBatch.updateMany({
          where: { id: batch.id, status: { not: "CANCELLED" } },
          data: { status: "REVIEW", reason: kind },
        });
      await audit(tx, batch.campaignId, "dispatch_result", "worker", {
        recipientId: recipient.id,
        status,
        kind,
      });
    });
    return { reason: kind };
  }
}
