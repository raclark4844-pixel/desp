import Link from "next/link";
import { db } from "@/lib/db";
import { requireEmployeePage } from "@/lib/employee/page";
import { Brand } from "@/components/brand";
import { FinanceNav } from "@/components/finance-nav";
import { BillingForm } from "@/components/billing-form";
import { billingConfigured, RYAN } from "@/lib/billing/service";
import { usd, weeklyCutoff } from "@/lib/billing/schedule";
export const dynamic = "force-dynamic";
export const metadata = { title: "Weekly lead invoices" };
export default async function Billing({
  searchParams,
}: {
  searchParams: Promise<{ customer?: string }>;
}) {
  const employee = await requireEmployeePage();
  const query = await searchParams;
  const [customers, config] = await Promise.all([
    db.customer.findMany({
      orderBy: { name: "asc" },
      include: { billingPreference: true },
    }),
    db.billingConfig.findUnique({ where: { id: "main" } }),
  ]);
  const selected =
    customers.find((c) => c.id === query.customer) || customers[0];
  const invoices = await db.billingInvoice.findMany({
    where: selected ? { customerId: selected.id } : {},
    orderBy: { cutoff: "desc" },
    include: { _count: { select: { lines: true } } },
  });
  return (
    <main className="page-shell">
      <Brand />
      <FinanceNav />
      <h1>Weekly lead summaries and invoices</h1>
      <p>
        <strong>
          $60.00 per lead sent to the campaign’s customer contact.
        </strong>{" "}
        No charge for queued, failed, or uncertain lead sends. No automatic
        payment is taken.
      </p>
      <p>
        Scheduled for the end of Friday: Saturday at 12:00 a.m. Eastern. The
        worker checks every five minutes and catches up after outages. One
        invoice per customer per cutoff includes all previously unbilled sent
        leads across their campaigns; no empty invoices are sent.
      </p>
      <p className="notice">
        {billingConfigured()
          ? "Verified invoice email sending is configured."
          : "Invoice emails are waiting for a verified sender and email API setup. Invoice records can still be prepared automatically; nothing is emailed until setup is complete."}
      </p>
      <form>
        <label>
          Customer
          <select name="customer" defaultValue={selected?.id}>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <button>Show invoices</button>
      </form>
      {selected && (
        <>
          <h2>{selected.name}</h2>
          <p>
            Customer email:{" "}
            {selected.billingPreference?.email ||
              selected.contactEmail ||
              "Missing — add an invoice email"}
            <br />
            Copy to: {RYAN}
            <br />
            Additional copy: {config?.thirdEmail || "To be defined later"}
          </p>
          <p>
            Weekly invoicing:{" "}
            {selected.billingPreference?.enabled === false
              ? "Paused"
              : "Enabled"}
          </p>
          {employee.isAdmin && (
            <details>
              <summary>Invoice email settings</summary>
              <BillingForm action="SETTINGS" customerId={selected.id}>
                <label>
                  Customer invoice email (blank uses customer record)
                  <input
                    type="email"
                    name="email"
                    defaultValue={selected.billingPreference?.email || ""}
                    maxLength={320}
                  />
                </label>
                <label>
                  Additional email for ALL customer invoices (optional)
                  <input
                    type="email"
                    name="thirdEmail"
                    defaultValue={config?.thirdEmail || ""}
                    maxLength={320}
                  />
                </label>
                <label>
                  <input
                    type="checkbox"
                    name="enabled"
                    defaultChecked={
                      selected.billingPreference?.enabled !== false
                    }
                  />
                  Automatically prepare and email this customer’s weekly
                  invoices when email setup is complete
                </label>
                <p>
                  Recipients on already-created invoices are preserved. Review
                  any failed or unknown email in the provider before resending.
                </p>
              </BillingForm>
            </details>
          )}
          <div className="customer-table-scroll">
            <table className="customer-table">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Cutoff (Eastern)</th>
                  <th>Leads</th>
                  <th>Total</th>
                  <th>Email status</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((i) => (
                  <tr key={i.id}>
                    <td>
                      <Link href={`/billing/${i.id}`}>{i.number}</Link>
                    </td>
                    <td>
                      {i.cutoff.toLocaleString("en-US", {
                        timeZone: "America/New_York",
                      })}
                    </td>
                    <td>{i._count.lines}</td>
                    <td>{usd(i.totalCents)}</td>
                    <td>{i.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!invoices.length && (
            <p>
              No invoices yet. The latest completed weekly cutoff is{" "}
              {weeklyCutoff().toLocaleString("en-US", {
                timeZone: "America/New_York",
              })}{" "}
              Eastern.
            </p>
          )}
        </>
      )}
    </main>
  );
}
