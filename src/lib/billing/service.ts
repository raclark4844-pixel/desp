import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "../db";
import { queueLock } from "../outreach/service";
import { UNIT_CENTS, weeklyCutoff, usd, BILLING_ZONE } from "./schedule";
export const RYAN = "ryan@demoretechnologysolutions.com";
export const billingConfigured = () =>
  !!process.env.RESEND_API_KEY &&
  !!process.env.BILLING_FROM &&
  process.env.BILLING_EMAIL_VERIFIED === "true";
const email = z.email().max(320);
export async function billingAction(raw: unknown, actor: string) {
  const input = z
    .discriminatedUnion("action", [
      z.object({
        action: z.literal("SETTINGS"),
        customerId: z.string().uuid(),
        email: z.union([email, z.literal("")]),
        enabled: z.boolean(),
        thirdEmail: z.union([email, z.literal("")]),
      }),
      z.object({
        action: z.literal("COST"),
        id: z.string().uuid(),
        campaignId: z.string().uuid(),
        type: z.enum(["DATA", "ENRICHMENT", "SMS", "EMAIL", "AI", "OTHER"]),
        provider: z.string().trim().min(1).max(100),
        description: z.string().trim().min(2).max(500),
        amount: z.coerce.number().finite().min(0).max(1000000),
        date: z.iso.date(),
      }),
      z.object({
        action: z.literal("RATES"),
        campaignId: z.string().uuid(),
        rates: z.partialRecord(
          z.enum(["DATA", "ENRICHMENT", "SMS", "EMAIL", "CALL", "AI"]),
          z.coerce.number().finite().min(0).max(10000),
        ),
      }),
    ])
    .parse(raw);
  return db.$transaction(async (tx) => {
    await queueLock(tx);
    if (input.action === "SETTINGS") {
      await tx.billingPreference.upsert({
        where: { customerId: input.customerId },
        create: {
          customerId: input.customerId,
          email: input.email || null,
          enabled: input.enabled,
        },
        update: { email: input.email || null, enabled: input.enabled },
      });
      await tx.billingConfig.upsert({
        where: { id: "main" },
        create: { id: "main", thirdEmail: input.thirdEmail || null },
        update: { thirdEmail: input.thirdEmail || null },
      });
    } else if (input.action === "COST") {
      const c = await tx.campaign.findUniqueOrThrow({
        where: { id: input.campaignId },
      });
      if (await tx.cost.findUnique({ where: { id: input.id } })) return;
      await tx.cost.create({
        data: {
          id: input.id,
          customerId: c.customerId,
          campaignId: c.id,
          type: input.type,
          provider: input.provider,
          amount: input.amount.toFixed(4),
          incurredAt: new Date(input.date + "T12:00:00Z"),
          metadata: {
            description: input.description,
            enteredBy: actor,
            basis: "ACTUAL",
          },
        },
      });
    } else {
      const c = await tx.campaign.findUniqueOrThrow({
        where: { id: input.campaignId },
      });
      await tx.campaign.update({
        where: { id: c.id },
        data: {
          outreachConfig: {
            ...(c.outreachConfig as Record<string, unknown>),
            costRates: input.rates,
          },
        },
      });
    }
    await tx.auditEvent.create({
      data: {
        eventType: `billing.${input.action.toLowerCase()}`,
        actorType: "EMPLOYEE",
        actorId: actor,
        payload: {
          customerId: "customerId" in input ? input.customerId : null,
          campaignId: "campaignId" in input ? input.campaignId : null,
        },
      },
    });
  });
}
export async function generateInvoice(
  customerId: string,
  cutoff = weeklyCutoff(),
) {
  return db.$transaction(
    async (tx) => {
      await queueLock(tx);
      const existing = await tx.billingInvoice.findUnique({
        where: { customerId_cutoff: { customerId, cutoff } },
      });
      if (existing) return existing;
      const customer = await tx.customer.findUniqueOrThrow({
        where: { id: customerId },
        include: { billingPreference: true },
      });
      if (
        customer.status !== "ACTIVE" ||
        customer.billingPreference?.enabled === false
      )
        return null;
      const config = await tx.billingConfig.findUnique({
        where: { id: "main" },
      });
      const recipient =
        customer.billingPreference?.email || customer.contactEmail;
      if (!email.safeParse(recipient).success) return null;
      const jobs = await tx.replyNotification.findMany({
        where: {
          kind: "LEAD_HANDOFF",
          status: "SENT",
          updatedAt: { lt: cutoff },
          target: { campaign: { customerId } },
        },
        orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
        include: { target: { include: { campaign: true } } },
      });
      const billed = await tx.billingInvoiceLine.findMany({
        where: { campaignId: { in: jobs.map((j) => j.target.campaignId) } },
        select: { notificationId: true, campaignId: true, leadId: true },
      });
      const seen = new Set(billed.map((b) => `${b.campaignId}:${b.leadId}`));
      const notifications = new Set(billed.map((b) => b.notificationId));
      const lines = [];
      for (const job of jobs) {
        if (notifications.has(job.id)) continue;
        const conversation = await tx.conversation.findUnique({
          where: { id: job.conversationId },
        });
        if (!conversation || conversation.campaignId !== job.target.campaignId)
          continue;
        const key = `${conversation.campaignId}:${conversation.leadId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        lines.push({
          notificationId: job.id,
          campaignId: conversation.campaignId,
          campaignName: job.target.campaign.name,
          leadId: conversation.leadId,
          summary: job.body || "Qualified lead",
          sentAt: job.updatedAt,
        });
      }
      if (!lines.length) return null;
      const id = randomUUID();
      const invoice = await tx.billingInvoice.create({
        data: {
          id,
          customerId,
          customerName: customer.name,
          number: `APS-${cutoff.toISOString().slice(0, 10).replaceAll("-", "")}-${id.slice(0, 8).toUpperCase()}`,
          cutoff,
          recipients: [
            ...new Set(
              [recipient!, RYAN, config?.thirdEmail]
                .filter((v): v is string => !!v)
                .map((v) => v.toLowerCase()),
            ),
          ],
          unitCents: UNIT_CENTS,
          totalCents: lines.length * UNIT_CENTS,
          lines: { create: lines },
        },
      });
      await tx.auditEvent.create({
        data: {
          customerId,
          eventType: "billing.invoice_created",
          actorType: "SYSTEM",
          payload: {
            invoiceId: id,
            leadCount: lines.length,
            totalCents: invoice.totalCents,
          },
        },
      });
      return invoice;
    },
    { timeout: 30000 },
  );
}
export function invoiceText(invoice: {
  number: string;
  customerName: string;
  cutoff: Date;
  unitCents: number;
  totalCents: number;
  lines: { campaignName: string; summary: string; sentAt: Date }[];
}) {
  return `AP Spartan — weekly lead summary / invoice\nInvoice: ${invoice.number}\nCustomer: ${invoice.customerName}\nWeekly cutoff: ${invoice.cutoff.toLocaleString("en-US", { timeZone: BILLING_ZONE })} Eastern\n\n${invoice.lines.map((l, i) => `${i + 1}. ${l.campaignName} — sent ${l.sentAt.toLocaleDateString("en-US", { timeZone: BILLING_ZONE })}\n${l.summary}`).join("\n\n")}\n\nTotal leads: ${invoice.lines.length}\n${invoice.lines.length} × ${usd(invoice.unitCents)} = ${usd(invoice.totalCents)} USD\nTotal due: ${usd(invoice.totalCents)} USD\n\nIncludes previously unbilled leads sent before this cutoff. No automatic payment is taken. Questions: ${RYAN}\nAP Spartan · Powered by Demore Technology Solutions`;
}
export async function dispatchInvoice() {
  if (process.env.VERCEL_ENV !== "production" || !billingConfigured())
    return "EMAIL_SETUP_REQUIRED";
  const invoice = await db.$transaction(async (tx) => {
    await queueLock(tx);
    await tx.billingInvoice.updateMany({
      where: {
        status: "SENDING",
        updatedAt: { lt: new Date(Date.now() - 120000) },
      },
      data: {
        status: "UNKNOWN",
        reason: "Check email provider before any resend.",
      },
    });
    const i = await tx.billingInvoice.findFirst({
      where: {
        status: "READY",
        customer: {
          status: "ACTIVE",
          OR: [
            { billingPreference: { is: null } },
            { billingPreference: { is: { enabled: true } } },
          ],
        },
      },
      orderBy: { createdAt: "asc" },
      include: {
        lines: { orderBy: [{ campaignName: "asc" }, { sentAt: "asc" }] },
        customer: { include: { billingPreference: true } },
      },
    });
    if (!i) return null;
    if (i.customer.billingPreference?.enabled === false) return null;
    await tx.billingInvoice.update({
      where: { id: i.id },
      data: { status: "SENDING" },
    });
    return i;
  });
  if (!invoice) return "NO_INVOICE_READY";
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `invoice-${invoice.id}`,
      },
      body: JSON.stringify({
        from: process.env.BILLING_FROM,
        to: invoice.recipients,
        reply_to: RYAN,
        subject: `AP Spartan invoice ${invoice.number} — ${invoice.lines.length} leads — ${usd(invoice.totalCents)}`,
        text: invoiceText(invoice),
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) {
      await db.billingInvoice.update({
        where: { id: invoice.id },
        data: {
          status: r.status >= 500 || r.status === 429 ? "UNKNOWN" : "FAILED",
          reason: `Email provider status ${r.status}`,
        },
      });
      return "FAILED";
    }
    const response = await r.json();
    if (typeof response.id !== "string") throw Error("Missing receipt");
    await db.billingInvoice.update({
      where: { id: invoice.id },
      data: { status: "SENT", providerId: response.id, sentAt: new Date() },
    });
    return "SENT";
  } catch {
    await db.billingInvoice.update({
      where: { id: invoice.id },
      data: {
        status: "UNKNOWN",
        reason: "Email result unknown; check provider. No automatic resend.",
      },
    });
    return "UNKNOWN";
  }
}
export async function billingWorker(now = new Date()) {
  const cutoff = weeklyCutoff(now);
  // Drain customers over successive runs, including catch-up after an outage.
  const customers = await db.$queryRaw<
    { id: string }[]
  >`SELECT DISTINCT c.id FROM "Customer" c JOIN "Campaign" p ON p."customerId"=c.id JOIN "NotificationTarget" t ON t."campaignId"=p.id JOIN "ReplyNotification" n ON n."targetId"=t.id JOIN "Conversation" v ON v.id=n."conversationId" LEFT JOIN "BillingPreference" b ON b."customerId"=c.id WHERE c.status='ACTIVE' AND COALESCE(b.enabled,true)=true AND COALESCE(b.email,c."contactEmail",'') LIKE '%@%' AND n.kind='LEAD_HANDOFF' AND n.status='SENT' AND n."updatedAt"<${cutoff} AND NOT EXISTS (SELECT 1 FROM "BillingInvoice" i WHERE i."customerId"=c.id AND i.cutoff=${cutoff}) AND NOT EXISTS (SELECT 1 FROM "BillingInvoiceLine" l WHERE l."notificationId"=n.id OR (l."campaignId"=p.id AND l."leadId"=v."leadId")) ORDER BY c.id LIMIT 20`;
  let created = 0;
  for (const c of customers) if (await generateInvoice(c.id, cutoff)) created++;
  return { created, delivery: await dispatchInvoice() };
}
