import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireEmployeePage } from "@/lib/employee/page";
import { Brand } from "@/components/brand";
import { FinanceNav } from "@/components/finance-nav";
export const dynamic = "force-dynamic";
export default async function CampaignRecord({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireEmployeePage();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const campaign = await db.campaign.findUnique({
    where: { id },
    include: {
      customer: true,
      providerJobs: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!campaign) notFound();
  const leads = await db.replyNotification.findMany({
    where: { kind: "LEAD_HANDOFF", target: { campaignId: id } },
    orderBy: { createdAt: "desc" },
  });
  return (
    <main className="page-shell">
      <Brand />
      <FinanceNav />
      <h1>{campaign.name}</h1>
      <p>
        {campaign.customer.name} · {campaign.status}
      </p>
      <p>
        <Link href={`/campaign-costs?campaign=${id}`}>View campaign costs</Link>{" "}
        ·{" "}
        <Link href={`/billing?customer=${campaign.customerId}`}>
          Customer invoices
        </Link>
      </p>
      <h2>
        {leads.filter((l) => l.status === "SENT").length} leads sent to customer
      </h2>
      {leads.map((l) => (
        <details key={l.id}>
          <summary>
            {l.status} ·{" "}
            {l.updatedAt.toLocaleString("en-US", {
              timeZone: "America/New_York",
            })}
          </summary>
          <pre className="billing-summary">{l.body}</pre>
          <Link href={`/inbox?conversation=${l.conversationId}`}>
            Open conversation
          </Link>
        </details>
      ))}
      <h2>Campaign execution history</h2>
      {campaign.providerJobs.map((j) => (
        <p key={j.id}>
          {j.startedAt?.toLocaleString() || "Not started"} · {j.jobType} ·{" "}
          {j.provider} · {j.status} · {j.attemptCount} attempts
        </p>
      ))}
    </main>
  );
}
