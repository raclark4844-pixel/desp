import { z } from "zod";
import { db } from "../db";
import { queueLock, audit } from "../outreach/service";
import { fail } from "./senders";
export async function setPrimaryContact(raw: unknown, actor: string) {
  const input = z
    .object({
      campaignId: z.string().uuid(),
      targetId: z.string().uuid().nullable(),
    })
    .strict()
    .parse(raw);
  return db.$transaction(async (tx) => {
    await queueLock(tx);
    const target = input.targetId
      ? await tx.notificationTarget.findUnique({
          where: { id: input.targetId },
        })
      : null;
    if (
      input.targetId &&
      (!target ||
        target.campaignId !== input.campaignId ||
        target.channel !== "SMS" ||
        !target.enabled ||
        !(await tx.employee.findFirst({
          where: { id: target!.employeeId, isActive: true },
        })))
    )
      fail("Choose an enabled text-alert recipient for this campaign.");
    await tx.campaign.update({
      where: { id: input.campaignId },
      data: { primaryAlertTargetId: input.targetId },
    });
    await audit(tx, input.campaignId, "primary_employee_assigned", actor, {
      targetId: input.targetId,
    });
  });
}
export async function handoffPreview(conversationId: string) {
  const c = await db.conversation.findUniqueOrThrow({
    where: { id: conversationId },
    include: {
      campaign: true,
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
  const employee = t
    ? await db.employee.findFirst({
        where: { id: t.employeeId, isActive: true },
        select: { name: true },
      })
    : null;
  const valid =
    !!t &&
    t.enabled &&
    t.channel === "SMS" &&
    t.campaignId === c.campaignId &&
    !!employee;
  return {
    target: valid
      ? { id: t!.id, name: employee!.name, phone: t!.destination }
      : null,
    sourceMessageId: c.messages[0]?.id ?? null,
    suggestedBody: `A contact in ${c.campaign.name} has said they want to proceed. Please review the conversation and follow up.`,
    alerts: await db.replyNotification.findMany({
      where: { conversationId: c.id, kind: "HANDOFF" },
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
      body: z.string().trim().min(5).max(500),
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
    const message = await tx.message.findUnique({
      where: { id: input.sourceMessageId },
    });
    if (
      !message ||
      message.conversationId !== c.id ||
      message.direction !== "INBOUND"
    )
      fail("Review the person's incoming response first.");
    const target = await tx.notificationTarget.findUnique({
      where: { id: input.targetId },
    });
    if (
      target?.destination !== input.expectedPhone ||
      c.campaign.primaryAlertTargetId !== input.targetId ||
      !target ||
      target.campaignId !== c.campaignId ||
      target.channel !== "SMS" ||
      !target.enabled ||
      !(await tx.employee.findFirst({
        where: { id: target!.employeeId, isActive: true },
      }))
    )
      fail(
        "The campaign's primary employee changed or is unavailable. Refresh and review the recipient.",
      );
    const receiptKey = `handoff:${c.id}:${message!.id}`;
    const existing = await tx.replyNotification.findFirst({
      where: { receiptKey, kind: "HANDOFF" },
    });
    if (existing)
      return { status: existing.status, id: existing.id, alreadyQueued: true };
    const alert = await tx.replyNotification.create({
      data: {
        targetId: target!.id,
        receiptKey,
        conversationId: c.id,
        kind: "HANDOFF",
        body: input.body,
        destinationSnapshot: target!.destination,
      },
    });
    await tx.conversation.update({
      where: { id: c.id },
      data: {
        assignedTo: target!.employeeId,
        status: "QUALIFIED",
        campaignHold: true,
      },
    });
    await audit(tx, c.campaignId, "interested_contact_handoff", actor, {
      notificationId: alert.id,
      sourceMessageId: message!.id,
      targetId: target!.id,
      employeeConfirmedInterest: true,
    });
    return { status: alert.status, id: alert.id, alreadyQueued: false };
  });
}
