"use client";
import { useEffect, useState, type FormEvent } from "react";
type Batch = {
  id: string;
  campaignId: string;
  updatedAt: string;
  channel: string;
  status: string;
  subject: string;
  body: string;
  mailingAddress: string;
  recipientTimezone: string;
  reason: string | null;
  setup: string[];
  recentRecipients: {
    id: string;
    status: string;
    name: string;
    contact: string;
  }[];
  issues: { id: string; reason: string | null }[];
  campaign: { name: string; customer: { name: string } };
  counts: { status: string; count: number }[];
};
type Overview = {
  liveEnabled: boolean;
  campaigns: { id: string; name: string; customer: { name: string } }[];
  batches: Batch[];
};
export default function Sending({ admin }: { admin: boolean }) {
  const [data, setData] = useState<Overview | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [selectedCampaign, setSelectedCampaign] = useState(""),
    [channel, setChannel] = useState("SMS"),
    [review, setReview] = useState<string | null>(null);
  async function refresh() {
    const response = await fetch("/api/sending", { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error);
    setData(body.result);
  }
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setSelectedCampaign(params.get("campaignId") ?? "");
    const requestedChannel = params.get("channel");
    if (requestedChannel && ["SMS", "EMAIL", "CALL"].includes(requestedChannel))
      setChannel(requestedChannel);
    let alive = true;
    fetch("/api/sending", { cache: "no-store" })
      .then(async (r) => {
        const b = await r.json();
        if (!r.ok) throw new Error(b.error);
        if (alive) setData(b.result);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, []);
  async function change(method: string, payload: unknown) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/sending", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error);
      await refresh();
      setReview(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  async function optOut(id: string) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/sending/opt-out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!r.ok) throw new Error("Unable to record opt-out.");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    await change("POST", {
      campaignId: f.get("campaignId"),
      channel,
      subject: f.get("subject") ?? "",
      body: f.get("body"),
      mailingAddress: f.get("mailingAddress"),
      recipientTimezone: f.get("recipientTimezone"),
    });
  }
  const saved = data?.batches.find(
    (b) => b.campaignId === selectedCampaign && b.channel === channel,
  );
  return (
    <>
      <p className="form-section">
        <strong>
          {data?.liveEnabled
            ? "Live delivery switch is on. Each channel still requires completed setup and recipient checks."
            : "Live sending is OFF. You can prepare and queue campaigns; no messages or calls will be sent."}
        </strong>
      </p>
      <p>
        Approved campaigns run one at a time. Within a campaign: texts → email →
        phone calls. The queue waits for delivery confirmation, pauses for
        unresolved errors, and spaces channels at least 24 hours apart for each
        lead. Pausing cannot recall a request already handed to a provider.
      </p>
      <p role="alert">{error}</p>
      {!data ? (
        <p>Loading sending workspace…</p>
      ) : (
        <>
          {selectedCampaign && (
            <p>
              <a
                href={`/operations?campaignId=${selectedCampaign}#campaign-records`}
              >
                Return to this campaign’s pre-collection checklist
              </a>
            </p>
          )}
          <form
            key={`${selectedCampaign}:${channel}:${saved?.updatedAt ?? "new"}`}
            onSubmit={save}
            className="form-section employee-form"
          >
            <h2>Prepare a message</h2>
            <label>
              Campaign
              <select
                name="campaignId"
                value={selectedCampaign}
                onChange={(e) => setSelectedCampaign(e.target.value)}
                required
              >
                <option value="">Choose campaign</option>
                {data.campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.customer.name} — {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Channel
              <select
                value={channel}
                onChange={(e) => setChannel(e.target.value)}
              >
                <option value="SMS">1. Text message</option>
                <option value="EMAIL">2. Email</option>
                <option value="CALL">3. Employee-assisted phone call</option>
              </select>
            </label>
            {channel === "EMAIL" && (
              <label>
                Subject
                <input
                  name="subject"
                  defaultValue={saved?.subject ?? ""}
                  maxLength={160}
                  required
                />
              </label>
            )}
            <label>
              {channel === "CALL" ? "Approved employee call script" : "Message"}
              <textarea
                name="body"
                defaultValue={saved?.body ?? ""}
                rows={6}
                minLength={10}
                maxLength={channel === "SMS" ? 600 : 4000}
                required
              />
            </label>
            <p className="microcopy">
              Plain text only. Texts include the customer name and STOP
              instructions. Emails include the customer name, advertisement
              disclosure, mailing address and unsubscribe link. Phone calls ring
              your employee first; pressing 1 connects the prospect. The script
              is for the employee to read, with no recording or automated voice
              played to the prospect.
            </p>
            <label>
              Customer’s physical mailing address
              <textarea
                name="mailingAddress"
                defaultValue={saved?.mailingAddress ?? ""}
                minLength={10}
                maxLength={300}
                required
              />
            </label>
            <label>
              Verified audience timezone
              <select
                name="recipientTimezone"
                defaultValue={saved?.recipientTimezone ?? ""}
                required
              >
                <option value="">Choose the recipients’ timezone</option>
                {[
                  "America/New_York",
                  "America/Chicago",
                  "America/Denver",
                  "America/Phoenix",
                  "America/Los_Angeles",
                  "America/Anchorage",
                  "Pacific/Honolulu",
                ].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
            <p className="microcopy">
              Use a separate campaign for each recipient timezone. Dispatch is
              limited to weekdays, 10 AM–6 PM in that timezone. Your
              jurisdiction review must confirm these hours are appropriate.
            </p>
            <button
              disabled={busy || (!!saved && saved.status !== "DRAFT")}
              className="primary-button"
            >
              Save draft
            </button>
            <p>
              Saving the same campaign and channel updates its unapproved draft.
              Approved messages and their audience cannot be edited.
            </p>
          </form>
          <h2>Sending queue</h2>
          <button
            disabled={busy}
            onClick={() => {
              setError("");
              refresh().catch((e) => setError(e.message));
            }}
          >
            Refresh status
          </button>
          {!data.batches.length && <p>No sending drafts yet.</p>}
          {data.batches.map((b) => (
            <section
              key={b.id}
              className="form-section"
              style={{ marginTop: 24, overflowWrap: "anywhere" }}
            >
              <h3>
                {b.campaign.customer.name} — {b.campaign.name}
              </h3>
              <p>
                <strong>
                  {b.channel} · {b.status}
                </strong>
              </p>
              {b.subject && <p>Subject: {b.subject}</p>}
              <p style={{ whiteSpace: "pre-wrap" }}>{b.body}</p>
              <p>
                {b.mailingAddress} · {b.recipientTimezone}
              </p>
              <p>
                {b.counts
                  .map((c) => `${c.count} ${c.status.toLowerCase()}`)
                  .join(" · ") || "Audience is captured when approved."}
              </p>
              {b.reason && <p>Queue hold: {b.reason.replaceAll("_", " ")}</p>}
              {b.setup.length > 0 && (
                <details>
                  <summary>Setup still required ({b.setup.length})</summary>
                  <ul>
                    {b.setup.map((s) => (
                      <li key={s}>{s.replaceAll("_", " ")}</li>
                    ))}
                  </ul>
                </details>
              )}
              {b.issues.length > 0 && (
                <details>
                  <summary>Recipient holds ({b.issues.length})</summary>
                  <ul>
                    {b.issues.map((r) => (
                      <li key={r.id}>{r.reason?.replaceAll("_", " ")}</li>
                    ))}
                  </ul>
                  <a href="/operations/review">Open compliance review</a>
                </details>
              )}
              {b.recentRecipients.length > 0 && (
                <details>
                  <summary>Recent recipients / record opt-outs</summary>
                  <ul>
                    {b.recentRecipients.map((r) => (
                      <li key={r.id}>
                        {r.name} · {r.contact} · {r.status}{" "}
                        <button disabled={busy} onClick={() => optOut(r.id)}>
                          Record opt-out
                        </button>
                      </li>
                    ))}
                  </ul>
                  <p>
                    Record a recipient’s request to stop contact immediately.
                    This blocks future outreach across their matching lead
                    records; requests already handed to a provider cannot be
                    recalled.
                  </p>
                </details>
              )}
              {admin && (
                <div className="home-actions">
                  {b.status === "DRAFT" && (
                    <button disabled={busy} onClick={() => setReview(b.id)}>
                      Review &amp; approve
                    </button>
                  )}
                  {["QUEUED", "RUNNING"].includes(b.status) && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        change("PATCH", { id: b.id, action: "PAUSE" })
                      }
                    >
                      Pause
                    </button>
                  )}
                  {["PAUSED", "REVIEW"].includes(b.status) && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        change("PATCH", { id: b.id, action: "RESUME" })
                      }
                    >
                      Recheck &amp; resume
                    </button>
                  )}
                  {!["COMPLETED", "CANCELLED"].includes(b.status) && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        change("PATCH", { id: b.id, action: "CANCEL" })
                      }
                    >
                      Cancel remaining recipients
                    </button>
                  )}
                </div>
              )}
              {review === b.id && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    change("PATCH", {
                      id: b.id,
                      action: "APPROVE",
                      confirmReview: true,
                      expectedUpdatedAt: b.updatedAt,
                    });
                  }}
                >
                  <p>
                    Approval captures the current enrolled audience and freezes
                    this message. Once live setup is complete, the worker can
                    send it automatically after fresh checks.
                  </p>
                  <label style={{ display: "flex", gap: 12 }}>
                    <input type="checkbox" required style={{ width: "auto" }} />
                    I reviewed the sender, message, physical address, consent
                    and jurisdiction evidence, and confirmed every recipient is
                    in the selected timezone.
                  </label>
                  <button disabled={busy} type="submit">
                    Approve and queue
                  </button>
                  <button type="button" onClick={() => setReview(null)}>
                    Back
                  </button>
                </form>
              )}
            </section>
          ))}
        </>
      )}
    </>
  );
}
