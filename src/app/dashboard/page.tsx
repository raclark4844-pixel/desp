import Link from "next/link";
import type { Metadata } from "next";
import { Brand } from "@/components/brand";
import { requireEmployeePage } from "@/lib/employee/page";
import { db } from "@/lib/db";
import {
  customerStatusLabel,
  customerStatusValues,
} from "@/lib/customer-status";
import styles from "./dashboard.module.css";

export const metadata: Metadata = {
  title: "Dashboard",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const employee = await requireEmployeePage();

  const [
    customerGroups,
    campaignGroups,
    customerCount,
    campaignCount,
    leadCount,
    attentionJobs,
    recentCustomers,
    recentEvents,
  ] = await Promise.all([
    db.customer.groupBy({ by: ["status"], _count: { _all: true } }),
    db.campaign.groupBy({ by: ["status"], _count: { _all: true } }),
    db.customer.count(),
    db.campaign.count(),
    db.lead.count(),
    db.providerJob.count({ where: { status: { in: ["BLOCKED", "FAILED", "WAITING_MANUAL"] } } }),
    db.customer.findMany({
      orderBy: { updatedAt: "desc" },
      take: 8,
      select: {
        id: true,
        name: true,
        status: true,
        contactName: true,
        contactEmail: true,
        updatedAt: true,
        _count: { select: { campaigns: true, leads: true } },
      },
    }),
    db.auditEvent.findMany({
      where: { customerId: { not: null } },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        eventType: true,
        createdAt: true,
        customer: { select: { id: true, name: true } },
      },
    }),
  ]);

  const customerCounts = new Map(customerGroups.map((group) => [group.status, group._count._all]));
  const runningCampaigns = campaignGroups
    .filter((group) => ["READY", "RUNNING"].includes(group.status))
    .reduce((sum, group) => sum + group._count._all, 0);

  return (
    <main className="page-shell">
      <Brand />
      <nav className="employee-nav" aria-label="Main navigation">
        <span>Signed in as {employee.name}</span>
        <Link href="/operations">Operations</Link>
        <Link href="/customers">Customers</Link>
        <Link href="/campaigns/new">Create campaign</Link>
        <Link href="/inbox">Inbox</Link>
        <Link href="/sending">Sending</Link>
        <Link href="/billing">Invoices</Link>
        <Link href="/account">My account</Link>
        {employee.isAdmin ? <Link href="/admin/users">Manage employees</Link> : null}
      </nav>

      <header className={styles.hero}>
        <div>
          <p className="eyebrow">AP SPARTAN · DASHBOARD</p>
          <h1>Customer & campaign control center</h1>
          <p className="hero-copy">
            Search customers, watch lifecycle status, see campaign volume, and jump into the parts of the lead engine that need attention.
          </p>
        </div>
        <form action="/customers" className={styles.search}>
          <label>
            Search everything saved on a customer
            <input name="q" maxLength={100} placeholder="Company, email, phone, address, service, ID…" />
          </label>
          <button className="primary-button">Search customers</button>
        </form>
      </header>

      <section className={styles.metrics} aria-label="Platform totals">
        <article><span>Customers</span><strong>{customerCount}</strong><small>{customerCounts.get("ACTIVE") ?? 0} active</small></article>
        <article><span>Campaigns</span><strong>{campaignCount}</strong><small>{runningCampaigns} ready or running</small></article>
        <article><span>Leads</span><strong>{leadCount}</strong><small>Canonical lead records</small></article>
        <article className={attentionJobs ? styles.attention : ""}><span>Needs attention</span><strong>{attentionJobs}</strong><small>Blocked, failed or manual jobs</small></article>
      </section>

      <section className={styles.statusSection}>
        <div className={styles.sectionTitle}>
          <div><p className="eyebrow">CUSTOMER LIFECYCLE</p><h2>Status board</h2></div>
          <Link href="/customers">Open full customer database →</Link>
        </div>
        <div className={styles.statusGrid}>
          {customerStatusValues.map((status) => (
            <Link href={`/customers?status=${status}`} className={styles.statusCard} key={status}>
              <span>{customerStatusLabel(status)}</span>
              <strong>{customerCounts.get(status) ?? 0}</strong>
            </Link>
          ))}
        </div>
      </section>

      <div className={styles.columns}>
        <section className="form-section">
          <div className={styles.sectionTitle}>
            <div><p className="eyebrow">RECENT CUSTOMERS</p><h2>Latest activity</h2></div>
            <Link href="/customers/new">Add customer →</Link>
          </div>
          {recentCustomers.length ? (
            <div className="customer-table-scroll">
              <table className="customer-table">
                <thead><tr><th>Customer</th><th>Status</th><th>Campaigns</th><th>Leads</th><th>Updated</th></tr></thead>
                <tbody>
                  {recentCustomers.map((customer) => (
                    <tr key={customer.id}>
                      <th>
                        <Link href={`/customers/${customer.id}`}>{customer.name}</Link>
                        <small>{customer.contactName || customer.contactEmail || customer.id}</small>
                      </th>
                      <td>{customerStatusLabel(customer.status)}</td>
                      <td>{customer._count.campaigns}</td>
                      <td>{customer._count.leads}</td>
                      <td>{customer.updatedAt.toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p>No customers yet.</p>}
        </section>

        <aside className="form-section">
          <p className="eyebrow">QUICK ACTIONS</p>
          <h2>Workspaces</h2>
          <div className={styles.actions}>
            <Link href="/customers">Customer database<span>Search and edit master customer records.</span></Link>
            <Link href="/campaigns/new">Create campaign<span>Build a campaign for an active customer.</span></Link>
            <Link href="/operations">Operations<span>Review campaign jobs, setup and contact collection.</span></Link>
            <Link href="/inbox">Campaign inbox<span>Review conversations and replies.</span></Link>
            <Link href="/sending">Campaign sending<span>Review delivery readiness and outbound batches.</span></Link>
            <Link href="/billing">Billing<span>Review invoices and customer billing records.</span></Link>
          </div>
        </aside>
      </div>

      <section className="form-section">
        <p className="eyebrow">RECENT AUDIT ACTIVITY</p>
        <h2>Customer record events</h2>
        {recentEvents.length ? (
          <ul className={styles.events}>
            {recentEvents.map((event) => (
              <li key={event.id}>
                <span>
                  {event.customer ? <Link href={`/customers/${event.customer.id}`}>{event.customer.name}</Link> : "Customer"} · {event.eventType.replaceAll(".", " · ").replaceAll("_", " ")}
                </span>
                <time dateTime={event.createdAt.toISOString()}>{event.createdAt.toLocaleString()}</time>
              </li>
            ))}
          </ul>
        ) : <p>No customer activity has been recorded yet.</p>}
      </section>
    </main>
  );
}
