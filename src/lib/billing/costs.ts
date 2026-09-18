import { db } from "../db";
export const metrics = [
  "DATA",
  "ENRICHMENT",
  "SMS",
  "EMAIL",
  "CALL",
  "AI",
] as const;
export async function campaignCosts(campaignId: string) {
  const campaign = await db.campaign.findUniqueOrThrow({
    where: { id: campaignId },
    include: { customer: true },
  });
  const [costs, jobs, alerts, ai, calls] = await Promise.all([
    db.cost.findMany({
      where: { campaignId },
      orderBy: { incurredAt: "desc" },
    }),
    db.providerJob.groupBy({
      by: ["jobType"],
      where: { campaignId },
      _sum: { attemptCount: true },
    }),
    db.replyNotification.findMany({
      where: {
        target: { campaignId },
        status: { in: ["SENT", "SENDING", "UNKNOWN"] },
      },
      select: { target: { select: { channel: true } } },
    }),
    db.auditEvent.count({
      where: {
        campaignId,
        eventType: {
          in: ["outreach.ai_draft_requested", "outreach.ai_monitor_requested"],
        },
      },
    }),
    db.outboundRecipient.count({
      where: {
        batch: { campaignId, channel: "CALL" },
        status: { in: ["ACCEPTED", "DELIVERED", "UNKNOWN"] },
      },
    }),
  ]);
  const [sms, email] = await Promise.all(
    ["SMS", "EMAIL"].map((channel) =>
      db.message.count({
        where: {
          conversation: { campaignId, channel: channel as "SMS" | "EMAIL" },
          direction: "OUTBOUND",
          status: { in: ["SENT", "DELIVERED"] },
        },
      }),
    ),
  );
  const quantities = {
    DATA: jobs
      .filter((j) => j.jobType === "SOURCE_LEADS")
      .reduce((s, j) => s + (j._sum.attemptCount || 0), 0),
    ENRICHMENT: jobs
      .filter((j) => j.jobType !== "SOURCE_LEADS")
      .reduce((s, j) => s + (j._sum.attemptCount || 0), 0),
    SMS: sms + alerts.filter((a) => a.target.channel === "SMS").length,
    EMAIL: email + alerts.filter((a) => a.target.channel === "EMAIL").length,
    CALL: calls,
    AI: ai,
  };
  const rates = ((campaign.outreachConfig as Record<string, unknown>)
    .costRates ?? {}) as Partial<Record<(typeof metrics)[number], number>>;
  const estimates = metrics.map((metric) => ({
    metric,
    quantity: quantities[metric],
    rate: rates[metric] ?? null,
    amount:
      rates[metric] === undefined ? null : quantities[metric] * rates[metric]!,
  }));
  return {
    campaign,
    costs,
    estimates,
    actual: costs
      .filter((c) => c.currency === "USD")
      .reduce((s, c) => s + Number(c.amount), 0),
    estimated: estimates.reduce((s, e) => s + (e.amount ?? 0), 0),
  };
}
