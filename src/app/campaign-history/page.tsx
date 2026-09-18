import Link from "next/link";
import { db } from "@/lib/db";
import { requireEmployeePage } from "@/lib/employee/page";
import { Brand } from "@/components/brand";
import { FinanceNav } from "@/components/finance-nav";
export const dynamic = "force-dynamic";
export const metadata = { title: "Customer campaign history" };
export default async function History({
  searchParams,
}: {
  searchParams: Promise<{ customer?: string }>;
}) {
  await requireEmployeePage();
  const { customer } = await searchParams;
  const customers = await db.customer.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  const selected = customers.find((c) => c.id === customer);
  const campaigns = await db.campaign.findMany({
    where: selected ? { customerId: selected.id } : {},
    include: {
      customer: true,
      providerJobs: {
        where: { startedAt: { not: null } },
        orderBy: { startedAt: "asc" },
        take: 1,
      },
      _count: { select: { campaignLeads: true } },
    },
  });
  const sent = await db.replyNotification.findMany({
    where: {
      kind: "LEAD_HANDOFF",
      status: "SENT",
      target: { campaignId: { in: campaigns.map((c) => c.id) } },
    },
    select: { target: { select: { campaignId: true } } },
  });
  campaigns.sort(
    (a, b) =>
      (b.providerJobs[0]?.startedAt?.getTime() ?? b.createdAt.getTime()) -
      (a.providerJobs[0]?.startedAt?.getTime() ?? a.createdAt.getTime()),
  );
  return (
    <main className="page-shell">
      <Brand />
      <FinanceNav />
      <h1>Campaign history by customer</h1>
      <form>
        <label>
          Customer
          <select name="customer" defaultValue={selected?.id || ""}>
            <option value="">All customers</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <button>Show history</button>
      </form>
      <p>
        Newest runs first within each customer. Campaigns that have not run show
        their creation date. “Leads sent” counts qualified lead texts accepted
        by the provider, not prospects contacted or drafts.
      </p>
      {customers
        .filter((c) => !selected || selected.id === c.id)
        .map((c) => (
          <section key={c.id}>
            <h2>{c.name}</h2><p><strong>{sent.filter(s=>campaigns.some(p=>p.id===s.target.campaignId && p.customerId===c.id)).length} total leads sent to this customer</strong></p>
            <div className="customer-table-scroll">
              <table className="customer-table">
                <thead>
                  <tr>
                    <th>Campaign</th>
                    <th>First run / created</th>
                    <th>Status</th>
                    <th>Leads enrolled</th>
                    <th>Leads sent to customer</th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns
                    .filter((x) => x.customerId === c.id)
                    .map((x) => (
                      <tr key={x.id}>
                        <td>
                          <Link href={`/campaign-history/${x.id}`}>
                            {x.name}
                          </Link>
                        </td>
                        <td>
                          {x.providerJobs[0]?.startedAt?.toLocaleString(
                            "en-US",
                            { timeZone: "America/New_York" },
                          ) ||
                            `Not run · created ${x.createdAt.toLocaleDateString()}`}
                        </td>
                        <td>{x.status}</td>
                        <td>{x._count.campaignLeads}</td>
                        <td>
                          {
                            sent.filter((s) => s.target.campaignId === x.id)
                              .length
                          }
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
    </main>
  );
}
