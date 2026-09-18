import { z } from "zod";
import { db } from "../db";
import { queueLock, audit } from "../outreach/service";
import { setupReasons, sendingWindow } from "../outreach/policy";
import {
  deliveryAdapter,
  DeliveryError,
  type DeliveryAdapter,
} from "../outreach/provider";
import { evaluateReadinessInTransaction } from "../compliance/service";
import { fail, phoneSchema } from "./senders";
export async function overview(campaignId?: string, cursor?: string) {
  if (campaignId) z.string().uuid().parse(campaignId);
  if (cursor) z.string().uuid().parse(cursor);
  const conversations = await db.conversation.findMany({
    where: campaignId ? { campaignId } : undefined,
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: 51,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: {
      campaign: { select: { name: true, customerId: true } },
      contact: { select: { normalizedValue: true } },
      lead: { select: { firstName: true, lastName: true, companyName: true } },
      _count: { select: { messages: true } },
    },
  });
  const [
    campaigns,
    employees,
    senders,
    targets,
    knowledge,
    unmatched,
    notifications,
  ] = await Promise.all([
    db.campaign.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
      select: { id: true, name: true, customerId: true, smsSenderId: true },
    }),
    db.employee.findMany({
      where: { isActive: true },
      select: { id: true, name: true, email: true },
    }),
    db.smsSender.findMany({ where: { active: true }, take: 1000 }),
    db.notificationTarget.findMany({
      where: campaignId ? { campaignId } : undefined,
      take: 500,
    }),
    db.replyKnowledge.findMany({
      where: { ...(campaignId ? { campaignId } : {}), active: true },
      take: 200,
      orderBy: { createdAt: "desc" },
    }),
    db.inboxReceipt.findMany({
      where: { conversationId: null },
      orderBy: { createdAt: "desc" },
      take: 25,
    }),
    db.replyNotification.groupBy({ by: ["status"], _count: true }),
  ]);
  return {
    conversations: conversations.slice(0, 50),
    nextCursor: conversations.length > 50 ? conversations[49].id : null,
    campaigns,
    employees,
    senders,
    targets,
    knowledge,
    unmatched,
    notifications,
    aiConfigured:
      process.env.INBOX_AI_ENABLED === "true" &&
      !!process.env.OPENAI_API_KEY &&
      !!process.env.INBOX_AI_MODEL,
    notificationsEnabled: process.env.INBOX_NOTIFICATIONS_ENABLED === "true",
    liveEnabled: process.env.OUTREACH_ENABLED === "true",
  };
}
export async function detail(id: string) {
  z.string().uuid().parse(id);
  return db.conversation.findUniqueOrThrow({
    where: { id },
    include: {
      campaign: { include: { customer: true } },
      contact: true,
      lead: true,
      messages: { orderBy: { createdAt: "desc" }, take: 200 },
      replies: { orderBy: { createdAt: "desc" }, take: 50 },
    },
  });
}
export async function updateConversation(raw: unknown, actor: string) {
  const input = z
    .object({
      id: z.string().uuid(),
      assignedTo: z.string().uuid().nullable(),
      status: z.enum(["OPEN", "WAITING", "QUALIFIED", "CLOSED", "ESCALATED"]),
      expectedUpdatedAt: z.iso.datetime(),
    })
    .strict()
    .parse(raw);
  return db.$transaction(async (tx) => {
    await queueLock(tx);
    if (
      input.assignedTo &&
      !(await tx.employee.findFirst({
        where: { id: input.assignedTo, isActive: true },
      }))
    )
      fail("Choose an active employee.");
    const c = await tx.conversation.findUniqueOrThrow({
      where: { id: input.id },
    });
    if (c.updatedAt.toISOString() !== input.expectedUpdatedAt)
      fail("Conversation changed. Refresh before saving.");
    await tx.conversation.update({
      where: { id: c.id },
      data: {
        assignedTo: input.assignedTo,
        status: input.status,
        needsReply: input.status === "CLOSED" ? false : c.needsReply,
      },
    });
    await audit(tx, c.campaignId, "inbox_assigned", actor, {
      conversationId: c.id,
      status: input.status,
      assignedTo: input.assignedTo,
    });
  });
}
export async function saveReply(raw: unknown, actor: string) {
  const input = z
    .object({
      conversationId: z.string().uuid(),
      requestId: z.string().uuid(),
      body: z.string().trim().min(1).max(4000),
    })
    .strict()
    .parse(raw);
  return db.$transaction(async (tx) => {
    await queueLock(tx);
    const c = await tx.conversation.findUniqueOrThrow({
      where: { id: input.conversationId },
    });
    if (!["SMS", "EMAIL"].includes(c.channel))
      fail("Replies are available for text and email conversations.");
    if (c.channel === "SMS" && input.body.length > 600)
      fail("Text replies must be 600 characters or fewer.");
    const prior = await tx.inboxReply.findUnique({
      where: { requestId: input.requestId },
    });
    if (prior) {
      if (prior.body !== input.body || prior.conversationId !== c.id)
        fail("Draft request conflict. Refresh and save again.");
      return prior.id;
    }
    const draft = await tx.inboxReply.create({
      data: { ...input, createdBy: actor },
    });
    await audit(tx, c.campaignId, "reply_draft_saved", actor, {
      conversationId: c.id,
      replyId: draft.id,
    });
    return draft.id;
  });
}
export async function sendReply(
  raw: unknown,
  actor: string,
  adapter: DeliveryAdapter = deliveryAdapter,
) {
  const input = z
    .object({
      id: z.string().uuid(),
      confirm: z.literal(true),
      expectedUpdatedAt: z.iso.datetime(),
    })
    .strict()
    .parse(raw);
  const work = await db.$transaction(async (tx) => {
    await queueLock(tx);
    const reply = await tx.inboxReply.findUniqueOrThrow({
      where: { id: input.id },
      include: {
        conversation: {
          include: { campaign: { include: { customer: true } }, contact: true },
        },
      },
    });
    if (reply.status !== "DRAFT")
      fail(
        "This reply has already been submitted. Check its status; do not resend.",
      );
    const c = reply.conversation;
    if (c.updatedAt.toISOString() !== input.expectedUpdatedAt)
      fail(
        "A new message or assignment changed this conversation. Refresh and review it first.",
      );
    if (c.channel !== "SMS" && c.channel !== "EMAIL")
      fail("Unsupported reply channel.");
    const channel = c.channel as "SMS" | "EMAIL";
    const reasons = setupReasons(channel, c.campaign.customerId);
    const batch = await tx.outboundBatch.findUnique({
      where: { campaignId_channel: { campaignId: c.campaignId, channel } },
    });
    if (!batch || !sendingWindow(batch.recipientTimezone))
      reasons.push("OUTSIDE_APPROVED_REPLY_HOURS");
    if (channel === "SMS") {
      const sender = c.fromNumber
        ? await tx.smsSender.findUnique({ where: { phone: c.fromNumber } })
        : null;
      if (
        !sender ||
        !sender.active ||
        sender.customerId !== c.campaign.customerId ||
        sender.serviceSid !== process.env.TWILIO_MESSAGING_SERVICE_SID
      )
        reasons.push("CAMPAIGN_SENDER_REQUIRED");
    }
    if (
      await tx.inboxReply.count({
        where: { conversationId: c.id, status: { in: ["SENDING", "UNKNOWN"] } },
      })
    )
      reasons.push("PREVIOUS_REPLY_REQUIRES_REVIEW");
    if (
      await tx.inboxReply.count({
        where: {
          conversationId: c.id,
          status: { in: ["SENDING", "SENT", "DELIVERED"] },
          updatedAt: { gt: new Date(Date.now() - 60000) },
        },
      })
    )
      reasons.push("PLEASE_WAIT_BEFORE_ANOTHER_REPLY");
    const readiness = await evaluateReadinessInTransaction(tx, {
      campaignId: c.campaignId,
      leadId: c.leadId,
      contactId: c.contactId,
      channel,
    });
    reasons.push(...readiness.reasons);
    if (reasons.length) fail(reasons.join(", "));
    const message = await tx.message.create({
      data: {
        conversationId: c.id,
        contactId: c.contactId,
        provider: channel === "SMS" ? "twilio" : "resend",
        direction: "OUTBOUND",
        status: "QUEUED",
        body: reply.body,
        metadata: { replyId: reply.id, actorId: actor },
      },
    });
    await tx.inboxReply.update({
      where: { id: reply.id },
      data: { status: "SENDING", messageId: message.id },
    });
    await audit(tx, c.campaignId, "reply_sending", actor, {
      replyId: reply.id,
      conversationId: c.id,
    });
    return {
      c,
      reply,
      input: {
        id: reply.id,
        inboxReply: true,
        channel,
        smsFrom: c.fromNumber ?? undefined,
        replyToken: c.replyToken,
        destination: c.contact.normalizedValue,
        body: reply.body,
        subject: `Re: ${batch!.subject || c.campaign.name}`,
        senderName: c.campaign.customer.name,
        mailingAddress: batch!.mailingAddress,
        unsubscribeToken:
          (
            await tx.outboundRecipient.findFirst({
              where: { batchId: batch!.id, contactId: c.contactId },
            })
          )?.unsubscribeToken ?? "",
      },
    };
  });
  try {
    const providerId = await adapter.send(work.input);
    await db.$transaction(async (tx) => {
      await queueLock(tx);
      const current = await tx.inboxReply.findUniqueOrThrow({
        where: { id: work.reply.id },
      });
      await tx.inboxReply.update({
        where: { id: current.id },
        data: {
          providerId,
          ...(current.status === "SENDING" ? { status: "SENT" } : {}),
        },
      });
      if (current.messageId)
        await tx.message.update({
          where: { id: current.messageId },
          data: {
            providerMessageId: providerId,
            sentAt: new Date(),
            status:
              current.status === "DELIVERED"
                ? "DELIVERED"
                : current.status === "FAILED"
                  ? "FAILED"
                  : "SENT",
          },
        });
      // A reply arriving while the provider call runs must remain unread.
      await tx.conversation.updateMany({
        where: { id: work.c.id, updatedAt: work.c.updatedAt },
        data: { needsReply: false, status: "WAITING" },
      });
      await audit(tx, work.c.campaignId, "reply_sent", actor, {
        replyId: current.id,
      });
    });
    return "SENT";
  } catch (error) {
    const status =
      error instanceof DeliveryError && error.kind !== "UNKNOWN"
        ? "FAILED"
        : "UNKNOWN";
    await db.inboxReply.updateMany({
      where: { id: work.reply.id, status: "SENDING" },
      data: { status, reason: "Review provider delivery before trying again." },
    });
    return status;
  }
}
export async function saveTarget(raw: unknown, actor: string) {
  const input = z
    .object({
      campaignId: z.string().uuid(),
      employeeId: z.string().uuid(),
      channel: z.enum(["EMAIL", "SMS"]),
      destination: z.string().trim().max(254),
      enabled: z.boolean(),
      confirmPermission: z.literal(true),
    })
    .strict()
    .parse(raw);
  const employee = await db.employee.findFirst({
    where: { id: input.employeeId, isActive: true },
  });
  if (!employee) fail("Employee not found.");
  const destination =
    input.channel === "SMS"
      ? phoneSchema.parse(input.destination)
      : z.email().parse(input.destination).toLowerCase();
  if (
    input.channel === "EMAIL" &&
    destination !== employee!.email.toLowerCase()
  )
    fail("Use the employee's account email address.");
  return db.$transaction(async (tx) => {
    await queueLock(tx);
    if (
      (await tx.notificationTarget.count({
        where: { campaignId: input.campaignId },
      })) >= 25 &&
      !(await tx.notificationTarget.findUnique({
        where: {
          campaignId_employeeId_channel: {
            campaignId: input.campaignId,
            employeeId: input.employeeId,
            channel: input.channel,
          },
        },
      }))
    )
      fail("Maximum 25 notification destinations per campaign.");
    await tx.notificationTarget.upsert({
      where: {
        campaignId_employeeId_channel: {
          campaignId: input.campaignId,
          employeeId: input.employeeId,
          channel: input.channel,
        },
      },
      create: {
        campaignId: input.campaignId,
        employeeId: input.employeeId,
        channel: input.channel,
        destination,
        enabled: input.enabled,
        confirmedAt: new Date(),
      },
      update: { destination, enabled: input.enabled, confirmedAt: new Date() },
    });
    await audit(tx, input.campaignId, "notification_target_saved", actor, {
      employeeId: input.employeeId,
      channel: input.channel,
      enabled: input.enabled,
    });
  });
}
export async function saveKnowledge(raw: unknown, actor: string) {
  const input = z
    .object({
      campaignId: z.string().uuid(),
      question: z.string().trim().min(3).max(500),
      answer: z.string().trim().min(3).max(3000),
    })
    .strict()
    .parse(raw);
  return db.$transaction(async (tx) => {
    await queueLock(tx);
    const k = await tx.replyKnowledge.create({
      data: { ...input, approvedBy: actor },
    });
    await audit(tx, input.campaignId, "knowledge_approved", actor, {
      knowledgeId: k.id,
    });
    return k.id;
  });
}
