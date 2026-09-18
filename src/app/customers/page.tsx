import Link from "next/link";
import { Brand } from "@/components/brand";
import { requireEmployeePage } from "@/lib/employee/page";
import { db } from "@/lib/db";
export const metadata = { title: "Customer database" };
export const dynamic = "force-dynamic";

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  await requireEmployeePage();
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim().slice(0, 100) : "";
  const parsedPage = Number(params.page);
  const page = Number.isSafeInteger(parsedPage) && parsedPage > 0 ? Math.min(parsedPage, 100000) : 1;
  const where = q ? { OR: [
    { name: { contains: q, mode: "insensitive" as const } },
    { contactName: { contains: q, mode: "insensitive" as const } },
    { contactEmail: { contains: q, mode: "insensitive" as const } },
  ] } : {};
  const [customers, count] = await Promise.all([
    db.customer.findMany({ where, orderBy: [{ name: "asc" }, { id: "asc" }], skip: (page - 1) * 50, take: 50, select: { id: true, name: true, contactName: true, contactEmail: true, websiteUrl: true, timezone: true, status: true, _count: { select: { campaigns: true } } } }),
    db.customer.count({ where }),
  ]);
  const pageUrl = (target: number) => `/customers?${new URLSearchParams({ q, page: String(target) })}`;
  return <main className="page-shell">
    <Brand />
    <nav className="employee-nav" aria-label="Main navigation"><Link href="/">Home</Link><Link href="/operations">Operations</Link><Link href="/campaigns/new">Create a campaign</Link><Link href="/account">My account</Link></nav>
    <h1>Customer database</h1>
    <p className="hero-copy">Your saved companies and primary contacts. To use a customer in a campaign, start typing their company name in the campaign form and press Tab on the matching suggestion.</p>
    <form action="/customers" className="customer-directory-search">
      <label>Find a customer<input name="q" defaultValue={q} maxLength={100} placeholder="Company, contact name, or email" /></label>
      <button className="primary-button">Search</button><Link href="/customers">Clear search</Link>
    </form>
    <p>{count} {count === 1 ? "customer" : "customers"}{q ? ` matching “${q}”` : " saved"}</p>
    {customers.length ? <div className="customer-table-scroll"><table className="customer-table"><caption>Saved customer information</caption><thead><tr><th scope="col">Company</th><th scope="col">Primary contact</th><th scope="col">Email</th><th scope="col">Website</th><th scope="col">Time zone</th><th scope="col">Status</th><th scope="col">Campaigns</th></tr></thead><tbody>
      {customers.map(customer => <tr key={customer.id}><th scope="row"><Link href={`/customers/${customer.id}`}>{customer.name}</Link><small>Customer ID: {customer.id}</small></th><td>{customer.contactName || "Not saved"}</td><td>{customer.contactEmail || "Not saved"}</td><td>{customer.websiteUrl && /^https?:\/\//i.test(customer.websiteUrl) ? <a href={customer.websiteUrl} target="_blank" rel="noopener noreferrer">{customer.websiteUrl}</a> : "Not saved"}</td><td>{customer.timezone}</td><td>{customer.status.toLowerCase()}</td><td>{customer._count.campaigns}</td></tr>)}
    </tbody></table></div> : <div className="notice"><p>{q ? "No customers match this search." : page > 1 ? "No customers on this page." : "No customers have been saved yet. Enter a new customer when creating your first campaign draft."}</p><Link href="/campaigns/new">Create a campaign draft</Link></div>}
    <nav className="employee-nav" aria-label="Customer pages">{page > 1 && <Link href={pageUrl(page - 1)}>← Previous</Link>}<span>Page {page} of {Math.max(1, Math.ceil(count / 50))}</span>{page * 50 < count && <Link href={pageUrl(page + 1)}>Next →</Link>}</nav>
  </main>;
}
