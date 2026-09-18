import { db } from "@/lib/db";
import { requireEmployeePage } from "@/lib/employee/page";
import { Brand } from "@/components/brand";
import { FinanceNav } from "@/components/finance-nav";
import { BillingForm } from "@/components/billing-form";
import { campaignCosts } from "@/lib/billing/costs";
export const dynamic = "force-dynamic";
export const metadata = { title: "Campaign costs" };
export default async function Costs({
  searchParams,
}: {
  searchParams: Promise<{ campaign?: string }>;
}) {
  const employee = await requireEmployeePage();
  const query = await searchParams;
  const campaigns = await db.campaign.findMany({
    orderBy: { createdAt: "desc" },
    include: { customer: { select: { name: true } } },
  });
  const selected =
    campaigns.find((c) => c.id === query.campaign) || campaigns[0];
  const data = selected ? await campaignCosts(selected.id) : null;
  return (
    <main className="page-shell">
      <Brand />
      <FinanceNav />
      <h1>Campaign operating costs</h1>
      <form>
        <label>
          Campaign
          <select name="campaign" defaultValue={selected?.id}>
            {campaigns.map((c) => (
              <option value={c.id} key={c.id}>
                {c.customer.name} — {c.name}
              </option>
            ))}
          </select>
        </label>
        <button>Show costs</button>
      </form>
      {data && (
        <>
          <h2>
            {data.campaign.customer.name} · {data.campaign.name}
          </h2>
          <p>
            Recorded costs: <strong>${data.actual.toFixed(2)} USD</strong> ·
            Usage estimate at your rates:{" "}
            <strong>${data.estimated.toFixed(2)} USD</strong>
          </p>
          <p>
            These are separate views; do not add them together. Estimates use
            your rates and observed app activity, not provider invoices. Blank
            rates mean unknown, not free. Shared subscriptions, number rental,
            hosting and setup can be allocated manually below. Customer invoices
            remain $60 per lead sent.
          </p>
          <div className="customer-table-scroll">
            <table className="customer-table">
              <thead>
                <tr>
                  <th>Service</th>
                  <th>Recorded usage</th>
                  <th>Rate / unit</th>
                  <th>Estimated cost</th>
                </tr>
              </thead>
              <tbody>
                {data.estimates.map((e) => (
                  <tr key={e.metric}>
                    <td>{e.metric}</td>
                    <td>{e.quantity}</td>
                    <td>{e.rate === null ? "Not configured" : `$${e.rate}`}</td>
                    <td>
                      {e.amount === null
                        ? "Unknown"
                        : `$${e.amount.toFixed(2)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Data/enrichment units are job attempts, AI units are requests,
            SMS/email units are messages, and phone units are accepted/uncertain
            call attempts. SMS segments, tokens, lookup rows, call minutes and
            failed billable requests may differ; reconcile with provider
            statements.
          </p>
          {employee.isAdmin && (
            <details>
              <summary>Configure estimated unit costs</summary>
              <BillingForm action="RATES" campaignId={selected!.id}>
                {data.estimates.map((e) => (
                  <label key={e.metric}>
                    {e.metric} cost per unit (USD)
                    <input
                      name={e.metric}
                      type="number"
                      step="0.0001"
                      min="0"
                      max="10000"
                      defaultValue={e.rate ?? ""}
                    />
                  </label>
                ))}
              </BillingForm>
            </details>
          )}
          <h2>Recorded expenses</h2>
          {data.costs.map((c) => (
            <p key={c.id}>
              {c.incurredAt.toLocaleDateString()} · {c.type} · {c.provider} · $
              {Number(c.amount).toFixed(2)} {c.currency} ·{" "}
              {String(
                (c.metadata as Record<string, unknown>).description || "",
              )}
            </p>
          ))}
          {!data.costs.length && <p>No expenses recorded yet.</p>}
          {employee.isAdmin && (
            <details>
              <summary>Add setup or running expense</summary>
              <BillingForm action="COST" campaignId={selected!.id}>
                <label>
                  Category
                  <select name="type">
                    <option>DATA</option>
                    <option>ENRICHMENT</option>
                    <option>SMS</option>
                    <option>EMAIL</option>
                    <option>AI</option>
                    <option>OTHER</option>
                  </select>
                </label>
                <label>
                  Provider / expense source
                  <input name="provider" required maxLength={100} />
                </label>
                <label>
                  Description (use Other for calls, hosting, setup or shared
                  fees)
                  <input name="description" required maxLength={500} />
                </label>
                <label>
                  Amount (USD)
                  <input
                    name="amount"
                    type="number"
                    step="0.0001"
                    min="0"
                    max="1000000"
                    required
                  />
                </label>
                <label>
                  Date
                  <input
                    name="date"
                    type="date"
                    required
                    defaultValue={new Date().toISOString().slice(0, 10)}
                  />
                </label>
              </BillingForm>
            </details>
          )}
        </>
      )}
    </main>
  );
}
