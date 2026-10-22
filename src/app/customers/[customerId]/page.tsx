import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireEmployeePage } from "@/lib/employee/page";
import { db } from "@/lib/db";
import { Brand } from "@/components/brand";
import { CustomerProfileForm } from "@/components/customer-profile-form";
import { CustomerStatusControl } from "@/components/customer-status-control";
import { editableProfile } from "@/lib/customer-profile";
import { customerStatusLabel, type CustomerStatusValue } from "@/lib/customer-status";

export const metadata = { title: "Customer profile" };
export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ customerId: string }> }) {
  const employee = await requireEmployeePage();
  const { customerId } = await params;
  if (!z.string().uuid().safeParse(customerId).success) notFound();

  const customer = await db.customer.findUnique({
    where: { id: customerId },
    include: {
      _count: { select: { campaigns: true, leads: true, users: true, invoices: true } },
      campaigns: {
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { id: true, name: true, industry: true, status: true, createdAt: true },
      },
      auditEvents: {
        where: { eventType: { in: ["customer.created", "customer.profile_updated", "customer.status_changed"] } },
        orderBy: { createdAt: "desc" },
        take: 15,
        select: { id: true, eventType: true, payload: true, createdAt: true },
      },
    },
  });
  if (!customer) notFound();

  const profile =
    customer.profile && typeof customer.profile === "object" && !Array.isArray(customer.profile)
      ? customer.profile
      : {};
  const source =
    typeof profile.sourceUrl === "string" && /^https?:\/\//i.test(profile.sourceUrl)
      ? profile.sourceUrl
      : null;

  return (
    <main className="page-shell">
      <Brand />
      <nav className="employee-nav">
        <Link href="/dashboard">Dashboard</Link>
        <Link href="/customers">← Customer database</Link>
        <Link href="/campaigns/new">Create a campaign</Link>
        <Link href="/operations">Operations</Link>
        <Link href={`/campaign-history?customer=${customerId}`}>Campaign history</Link>
        <Link href={`/billing?customer=${customerId}`}>Invoices</Link>
      </nav>

      <p className="eyebrow">CUSTOMER MASTER RECORD</p>
      <h1>{customer.name}</h1>
      <p>Customer ID: {customer.id}</p>
      <p className="hero-copy">
        Status: <strong>{customerStatusLabel(customer.status)}</strong> · Created {customer.createdAt.toLocaleDateString()} · Updated {customer.updatedAt.toLocaleString()}
      </p>

      <div className="result-grid">
        <div><strong>{customer._count.campaigns}</strong><p className="microcopy">Campaigns</p></div>
        <div><strong>{customer._count.leads}</strong><p className="microcopy">Leads</p></div>
        <div><strong>{customer._count.invoices}</strong><p className="microcopy">Invoices</p></div>
      </div>

      <CustomerStatusControl
        customerId={customer.id}
        initialStatus={customer.status as CustomerStatusValue}
        updatedAt={customer.updatedAt.toISOString()}
        isAdmin={employee.isAdmin}
      />

      {customer.campaigns.length ? (
        <section className="form-section">
          <p className="eyebrow">RECENT CAMPAIGNS</p>
          <h2>Campaign activity</h2>
          <div className="customer-table-scroll">
            <table className="customer-table">
              <thead><tr><th>Campaign</th><th>Industry</th><th>Status</th><th>Created</th></tr></thead>
              <tbody>
                {customer.campaigns.map((campaign) => (
                  <tr key={campaign.id}>
                    <th><Link href={`/operations?campaignId=${campaign.id}&customerId=${customer.id}`}>{campaign.name}</Link></th>
                    <td>{campaign.industry}</td>
                    <td>{campaign.status.toLowerCase().replaceAll("_", " ")}</td>
                    <td>{campaign.createdAt.toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {customer.auditEvents.length ? (
        <section className="form-section">
          <p className="eyebrow">CUSTOMER HISTORY</p>
          <h2>Recent record changes</h2>
          <ul>
            {customer.auditEvents.map((event) => {
              const payload = event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
                ? event.payload as Record<string, unknown>
                : {};
              return (
                <li key={event.id}>
                  <strong>{event.eventType.replaceAll(".", " · ").replaceAll("_", " ")}</strong>
                  {" · "}{event.createdAt.toLocaleString()}
                  {typeof payload.reason === "string" ? ` · ${payload.reason}` : ""}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {source && (
        <p>
          Initial business information imported from <a href={source} target="_blank" rel="noopener noreferrer">the company website</a>
          {typeof profile.importedAt === "string" ? ` on ${profile.importedAt.slice(0, 10)}` : ""}. Review and update the fields below.
        </p>
      )}

      <CustomerProfileForm
        key={customer.updatedAt.toISOString()}
        customer={{
          id: customer.id,
          name: customer.name,
          websiteUrl: customer.websiteUrl,
          contactName: customer.contactName,
          contactEmail: customer.contactEmail,
          timezone: customer.timezone,
          updatedAt: customer.updatedAt.toISOString(),
          profile: editableProfile(customer.profile),
        }}
      />
    </main>
  );
}
