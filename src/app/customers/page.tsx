import Link from "next/link";
import { Brand } from "@/components/brand";
import { requireEmployeePage } from "@/lib/employee/page";
import { db } from "@/lib/db";
import {
  customerStatusLabel,
  customerStatusValues,
  type CustomerStatusValue,
} from "@/lib/customer-status";

export const metadata = { title: "Customer database" };
export const dynamic = "force-dynamic";

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; status?: string }>;
}) {
  await requireEmployeePage();
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim().slice(0, 100) : "";
  const requestedStatus = typeof params.status === "string" ? params.status.toUpperCase() : "";
  const status = customerStatusValues.includes(requestedStatus as CustomerStatusValue)
    ? (requestedStatus as CustomerStatusValue)
    : "";
  const parsedPage = Number(params.page);
  const page = Number.isSafeInteger(parsedPage) && parsedPage > 0 ? Math.min(parsedPage, 100000) : 1;

  const profileIds = q
    ? (
        await db.$queryRaw<Array<{ id: string }>>`
          SELECT id
          FROM "Customer"
          WHERE COALESCE(profile::text, '') ILIKE ${`%${q}%`}
          LIMIT 500
        `
      ).map((row) => row.id)
    : [];

  const idMatch = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(q);
  const where = {
    ...(status ? { status } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" as const } },
            { slug: { contains: q, mode: "insensitive" as const } },
            { contactName: { contains: q, mode: "insensitive" as const } },
            { contactEmail: { contains: q, mode: "insensitive" as const } },
            { websiteUrl: { contains: q, mode: "insensitive" as const } },
            ...(idMatch ? [{ id: q }] : []),
            ...(profileIds.length ? [{ id: { in: profileIds } }] : []),
          ],
        }
      : {}),
  };

  const [customers, count] = await Promise.all([
    db.customer.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
      skip: (page - 1) * 50,
      take: 50,
      select: {
        id: true,
        name: true,
        contactName: true,
        contactEmail: true,
        websiteUrl: true,
        timezone: true,
        status: true,
        updatedAt: true,
        _count: { select: { campaigns: true, leads: true } },
      },
    }),
    db.customer.count({ where }),
  ]);

  const pageUrl = (target: number) =>
    `/customers?${new URLSearchParams({ q, status, page: String(target) })}`;

  return (
    <main className="page-shell">
      <Brand />
      <nav className="employee-nav" aria-label="Main navigation">
        <Link href="/dashboard">Dashboard</Link>
        <Link href="/operations">Operations</Link>
        <Link href="/campaigns/new">Create a campaign</Link>
        <Link href="/account">My account</Link>
        <Link href="/campaign-history">Campaign history</Link>
        <Link href="/campaign-costs">Campaign costs</Link>
        <Link href="/billing">Invoices</Link>
      </nav>
      <p className="eyebrow">CUSTOMER DATABASE</p>
      <h1>Customers</h1>
      <p><Link href="/customers/new" className="primary-button">Add customer</Link></p>
      <p className="hero-copy">
        Search the customer master record, including company/contact fields, website, customer ID and saved profile details.
      </p>
      <form action="/customers" className="customer-directory-search">
        <label>
          Find a customer
          <input name="q" defaultValue={q} maxLength={100} placeholder="Company, contact, email, phone, address, service, ID…" />
        </label>
        <label>
          Status
          <select name="status" defaultValue={status}>
            <option value="">All statuses</option>
            {customerStatusValues.map((value) => (
              <option value={value} key={value}>{customerStatusLabel(value)}</option>
            ))}
          </select>
        </label>
        <button className="primary-button">Search</button>
        <Link href="/customers">Clear search</Link>
      </form>
      <p>{count} {count === 1 ? "customer" : "customers"}{q ? ` matching “${q}”` : ""}{status ? ` · ${customerStatusLabel(status)}` : ""}</p>
      {customers.length ? (
        <div className="customer-table-scroll">
          <table className="customer-table">
            <caption>Saved customer information</caption>
            <thead><tr><th>Company</th><th>Primary contact</th><th>Email</th><th>Status</th><th>Campaigns</th><th>Leads</th><th>Updated</th></tr></thead>
            <tbody>
              {customers.map((customer) => (
                <tr key={customer.id}>
                  <th scope="row">
                    <Link href={`/customers/${customer.id}`}>{customer.name}</Link>
                    <small>Customer ID: {customer.id}</small>
                    {customer.websiteUrl && /^https?:\/\//i.test(customer.websiteUrl) ? (
                      <small><a href={customer.websiteUrl} target="_blank" rel="noopener noreferrer">{customer.websiteUrl}</a></small>
                    ) : null}
                  </th>
                  <td>{customer.contactName || "Not saved"}</td>
                  <td>{customer.contactEmail || "Not saved"}</td>
                  <td><strong>{customerStatusLabel(customer.status)}</strong></td>
                  <td><Link href={`/campaign-history?customer=${customer.id}`}>{customer._count.campaigns}</Link></td>
                  <td>{customer._count.leads}</td>
                  <td>{customer.updatedAt.toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="notice"><p>No customers match this view.</p><Link href="/customers/new">Add customer</Link></div>
      )}
      <nav className="employee-nav" aria-label="Customer pages">
        {page > 1 && <Link href={pageUrl(page - 1)}>← Previous</Link>}
        <span>Page {page} of {Math.max(1, Math.ceil(count / 50))}</span>
        {page * 50 < count && <Link href={pageUrl(page + 1)}>Next →</Link>}
      </nav>
    </main>
  );
}
