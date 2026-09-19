"use client";
import { ActivateCampaign } from "@/components/activate-campaign";
import { Brand } from "@/components/brand";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { OperationsData } from "@/lib/operations/service";
import styles from "./operations.module.css";
// JSON transport changes Date fields to ISO strings.
type Serialized<T> = T extends Date
  ? string
  : T extends (infer U)[]
    ? Serialized<U>[]
    : T extends object
      ? { [K in keyof T]: Serialized<T[K]> }
      : T;
type Data = Serialized<OperationsData>;
const label = (value: string) => value.toLowerCase().replaceAll("_", " ");
function Badge({ value }: { value: string }) {
  return <span className={styles.badge}>{label(value)}</span>;
}
export default function Operations({
  children,
  admin,
}: {
  children?: React.ReactNode;
  admin: boolean;
}) {
  const [data, setData] = useState<Data | null>(null),
    [locked, setLocked] = useState(true),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [search, setSearch] = useState("");
  const request = useRef<AbortController | null>(null);
  const filter = useRef({ search: "", customerId: "", campaignId: "" });
  async function load(next = filter.current) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    filter.current = next;
    setLoading(true);
    setError("");
    setData(null);
    try {
      const params = new URLSearchParams(
        Object.entries(next).filter(([, v]) => v),
      );
      const response = await fetch(`/api/internal/operations?${params}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (response.status === 401) {
        setLocked(true);
        return;
      }
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setData(result.result);
      setLocked(false);
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : "Unable to load operations.");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    return () => request.current?.abort();
  }, []);
  async function logout() {
    request.current?.abort();
    setLoading(true);
    setData(null);
    setError("");
    try {
      const response = await fetch("/api/employee/session", {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Sign-out failed. Please try again.");
      setLocked(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-out failed.");
    } finally {
      setLoading(false);
    }
  }
  return (
    <main className="page-shell">
      <Brand />
      {children}
      <nav className={styles.nav} aria-label="Main navigation">
        <Link href="/operations">Operations</Link>
        <Link href="/campaigns/new">Create a campaign ↗</Link>
      </nav>
      <header id="campaign-records" className={styles.header}>
        <div>
          <p className="eyebrow">OPERATIONS / SETUP</p>
          <h2>
            Your lead engine,
            <br />
            at a glance.
          </h2>
          <p className="hero-copy">
            Track campaign progress, review sourcing jobs, and see what needs
            attention.
          </p>
        </div>
        <div className={styles.safe}>
          <span>●</span> Outreach is off
          <small>No texts, emails, or calls are sent.</small>
        </div>
      </header>
      {error ? (
        <div className="notice error" role="alert">
          {error}
        </div>
      ) : null}
      {locked ? (
        <section className={`form-section ${styles.login}`}>
          <p className="eyebrow">PRIVATE WORKSPACE</p>
          <h2>Open operations</h2>
          <p>Sign in with your employee username or email and password.</p>
          <Link href="/login" className="primary-button">
            Employee sign-in
          </Link>
        </section>
      ) : (
        <>
          <div className={styles.toolbar}>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void load({ search, customerId: "", campaignId: "" });
              }}
            >
              <label className={styles.search}>
                Find a customer
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Company name or slug"
                  maxLength={100}
                />
              </label>
              <button className="secondary-button" disabled={loading}>
                Search
              </button>
            </form>
            <button
              className="secondary-button"
              onClick={() => void load()}
              disabled={loading}
            >
              Refresh
            </button>
            <button
              className="secondary-button"
              onClick={() => void logout()}
              disabled={loading}
            >
              Sign out
            </button>
          </div>
          {loading ? (
            <p role="status" className={styles.empty}>
              Loading the latest operations data…
            </p>
          ) : null}
          {data ? (
            <>
              <div className={styles.selectors}>
                <label>
                  Customer
                  <select
                    value={data.customer?.id ?? ""}
                    onChange={(e) =>
                      void load({
                        ...filter.current,
                        customerId: e.target.value,
                        campaignId: "",
                      })
                    }
                  >
                    {!data.customers.length ? (
                      <option value="">No matching customers</option>
                    ) : null}
                    {data.customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} · {label(c.status)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Campaign
                  <select
                    value={data.campaign?.id ?? ""}
                    onChange={(e) =>
                      void load({
                        ...filter.current,
                        customerId: data.customer?.id ?? "",
                        campaignId: e.target.value,
                      })
                    }
                  >
                    {!data.campaigns.length ? (
                      <option value="">No campaigns yet</option>
                    ) : null}
                    {data.campaigns.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} · {label(c.status)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {data.moreCustomers ? (
                <p className="microcopy">
                  Showing the first 50 customers. Narrow your search to find
                  others.
                </p>
              ) : null}
              {data.moreCampaigns ? (
                <p className="microcopy">
                  Showing the 50 most recent campaigns.
                </p>
              ) : null}
              {data.campaign &&
                ["DRAFT", "READY"].includes(data.campaign.status) &&
                (admin ? (
                  <ActivateCampaign
                    key={data.campaign.id}
                    campaignId={data.campaign.id}
                    name={data.campaign.name}
                    onRefresh={() => void load()}
                  />
                ) : (
                  <p>
                    An administrator can activate lead collection for this
                    campaign.
                  </p>
                ))}
              {data.campaign ? (
                <p>
                  <Link
                    href={`/operations/review?campaignId=${data.campaign.id}`}
                    className="secondary-button"
                  >
                    Review campaign contacts →
                  </Link>
                </p>
              ) : null}
              <div className={styles.metrics}>
                <article>
                  <span>Enrolled leads</span>
                  <strong>{data.leadCount}</strong>
                  <small>Current campaign</small>
                </article>
                <article>
                  <span>Contact records</span>
                  <strong>{data.contactCount}</strong>
                  <small>Availability does not mean consent</small>
                </article>
                <article>
                  <span>Jobs needing attention</span>
                  <strong>
                    {data.jobCounts
                      .filter((g) =>
                        ["BLOCKED", "FAILED", "WAITING_MANUAL"].includes(
                          g.status,
                        ),
                      )
                      .reduce((n, g) => n + g.count, 0)}
                  </strong>
                  <small>Blocked, failed, or awaiting import</small>
                </article>
                <article>
                  <span>Campaign state</span>
                  <strong className={styles.state}>
                    {data.campaign
                      ? label(data.campaign.status)
                      : "No campaign"}
                  </strong>
                  <small>
                    {data.customer
                      ? `${data.customer.name} · ${label(data.customer.status)}`
                      : "Choose or create a customer"}
                  </small>
                </article>
              </div>
              <div className={styles.columns}>
                <section className="form-section">
                  <p className="eyebrow">PROVIDER WORK</p>
                  <h2>Recent jobs</h2>
                  <p className="microcopy">
                    Latest 25 jobs for the selected campaign. Refresh to update.
                  </p>
                  {data.jobs.length ? (
                    <div className={styles.scroll}>
                      <table>
                        <thead>
                          <tr>
                            <th>Provider / task</th>
                            <th>Status</th>
                            <th>Attempts</th>
                            <th>Created</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.jobs.map((j) => (
                            <tr key={j.id}>
                              <td>
                                <strong>{j.provider}</strong>
                                <small>{label(j.jobType)}</small>
                                <small title={j.id}>
                                  Job {j.id.slice(0, 8)}
                                </small>
                              </td>
                              <td>
                                <Badge value={j.status} />
                                {j.nextAttemptAt ? (
                                  <small>
                                    Retry{" "}
                                    {new Date(j.nextAttemptAt).toLocaleString()}
                                  </small>
                                ) : null}
                              </td>
                              <td>{j.attemptCount}</td>
                              <td>{new Date(j.createdAt).toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className={styles.empty}>
                      No jobs yet. New campaigns remain drafts until an operator
                      activates them.
                    </p>
                  )}
                </section>
                <aside className="form-section">
                  <p className="eyebrow">SETUP CHECKLIST</p>
                  <h2>Before the first run</h2>
                  <ul className={styles.checklist}>
                    <li>
                      <strong>Property search key</strong>
                      <Badge
                        value={
                          data.setup.propertySearchKey
                            ? "CONFIGURED"
                            : "MISSING"
                        }
                      />
                      <p>A configured key still needs a live test.</p>
                    </li>
                    <li>
                      <strong>Contact enrichment</strong>
                      <Badge
                        value={
                          data.setup.enrichmentKey
                            ? "KEY_CONFIGURED"
                            : "KEY_MISSING"
                        }
                      />
                      <p>
                        Execution{" "}
                        {data.setup.enrichmentEnabled ? "enabled" : "disabled"}.
                        Live testing is deferred until setup is complete.
                      </p>
                    </li>
                    <li>
                      <strong>Scheduled worker</strong>
                      <Badge
                        value={
                          data.setup.schedulerKey
                            ? "KEY_CONFIGURED"
                            : "KEY_MISSING"
                        }
                      />
                      <p>Key presence does not confirm a successful run.</p>
                    </li>
                    <li>
                      <strong>Contact verification</strong>
                      <Badge value="NOT_CONNECTED" />
                      <p>
                        DNC, reassigned-number, ownership, and applicable
                        consent evidence are still required.
                      </p>
                    </li>
                    <li>
                      <strong>PropWire fallback</strong>
                      <Badge value="MANUAL_IMPORT" />
                      <p>
                        Manual exports can be imported through the protected
                        source workflow.
                      </p>
                    </li>
                    <li>
                      <strong>Outreach</strong>
                      <Badge value="DISABLED" />
                      <p>Readiness reviews cannot enable sending.</p>
                    </li>
                  </ul>
                </aside>
              </div>
              <section className="form-section">
                <p className="eyebrow">ACTIVITY</p>
                <h2>Recent campaign events</h2>
                {data.audits.length ? (
                  <ul className={styles.events}>
                    {data.audits.map((a) => (
                      <li key={a.id}>
                        <span>
                          {a.eventType
                            .replaceAll(".", " · ")
                            .replaceAll("_", " ")}
                        </span>
                        <time dateTime={a.createdAt}>
                          {new Date(a.createdAt).toLocaleString()}
                        </time>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className={styles.empty}>
                    Events will appear as this campaign moves through setup.
                  </p>
                )}
              </section>
              <p className="microcopy">
                Updated {new Date(data.updatedAt).toLocaleString()} · Read-only
                operator view · Contact details and evidence documents are
                excluded.
              </p>
            </>
          ) : null}
        </>
      )}
    </main>
  );
}
