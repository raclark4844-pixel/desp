"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ReviewContacts } from "@/lib/operations/review";
import type { evaluateReadiness } from "@/lib/compliance/service";
import { checkSchema, type Channel } from "@/lib/compliance/policy";
import { verificationRequirements } from "@/lib/verification/status";
import styles from "./review.module.css";
const words = (s: string) => s.toLowerCase().replaceAll("_", " ");
const errors: Record<string, string> = {
  Unauthorized:
    "Access expired or the key was not accepted. Sign in through operations, or enter the internal key to save.",
  INVALID_REVIEW_INPUT:
    "Check the selected contact, evidence fields, dates, and acknowledgement.",
  INVALID_EVIDENCE_EXPIRY:
    "Use an expiry in the future. Verification checks can cover at most 31 days from observation.",
  FUTURE_EVIDENCE: "The evidence observation time cannot be in the future.",
  IDEMPOTENCY_CONFLICT:
    "This request ID already belongs to a different record. Reload before preparing a new submission.",
  TARGET_NOT_FOUND: "The selected contact or campaign is no longer available.",
  REVIEW_UNAVAILABLE:
    "Review is temporarily unavailable. You can retry the same submission.",
};
async function resultOf(response: Response) {
  const body = await response.json();
  if (!response.ok)
    throw new Error(
      errors[body.error] ?? "The request could not be completed. Please retry.",
    );
  return body.result;
}
export default function Review({ campaignId }: { campaignId: string }) {
  const [page, setPage] = useState<ReviewContacts | null>(null),
    [contactId, setContactId] = useState(""),
    [channel, setChannel] = useState<Channel>("SMS"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [decision, setDecision] = useState<Awaited<
      ReturnType<typeof evaluateReadiness>
    > | null>(null);
  const [action, setAction] = useState("CHECK"),
    [check, setCheck] = useState("CONTACT_OWNERSHIP"),
    [outcome, setOutcome] = useState("UNKNOWN"),
    [consent, setConsent] = useState("REVOKED"),
    [reason, setReason] = useState("OPT_OUT"),
    [actor, setActor] = useState(""),
    [reference, setReference] = useState(""),
    [observed, setObserved] = useState(""),
    [expires, setExpires] = useState(""),
    [key, setKey] = useState(""),
    [ack, setAck] = useState(false);
  const pending = useRef<{ signature: string; requestId: string } | null>(null);
  const request = useRef<AbortController | null>(null);
  const contact = page?.contacts.find((c) => c.id === contactId);
  const target = contact
    ? { campaignId, leadId: contact.leadId, contactId: contact.id, channel }
    : null;
  async function load(after?: string) {
    request.current?.abort();
    const control = new AbortController();
    request.current = control;
    setBusy(true);
    setError("");
    setDecision(null);
    setNotice("");
    setContactId("");
    setPage(null);
    setKey("");
    setAck(false);
    try {
      const response = await fetch(
        `/api/internal/operations/review?${new URLSearchParams({ campaignId, ...(after ? { after } : {}) })}`,
        { cache: "no-store", signal: control.signal },
      );
      const data = await resultOf(response);
      if (!control.signal.aborted) setPage(data);
    } catch (e) {
      if (!control.signal.aborted)
        setError(e instanceof Error ? e.message : "Could not load contacts.");
    } finally {
      if (!control.signal.aborted) setBusy(false);
    }
  }
  useEffect(() => {
    void load();
    return () => request.current?.abort();
  }, [campaignId]);
  function clearDecision() {
    setDecision(null);
    setNotice("");
    setAck(false);
    setKey("");
  }
  async function evaluate() {
    if (!target) return;
    setBusy(true);
    setError("");
    setDecision(null);
    try {
      setDecision(
        await resultOf(
          await fetch("/api/internal/operations/review", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(target),
          }),
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not evaluate.");
    } finally {
      setBusy(false);
    }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!target || !ack) return;
    setBusy(true);
    setError("");
    setNotice("");
    setDecision(null);
    const supplied = key;
    setKey("");
    try {
      const base = {
        ...target,
        actorRef: actor,
        evidenceRef: reference,
        observedAt: new Date(observed).toISOString(),
      };
      const fields =
        action === "CHECK"
          ? {
              action,
              check,
              outcome,
              expiresAt: new Date(expires).toISOString(),
            }
          : action === "CONSENT"
            ? {
                action,
                status: consent,
                ...(consent === "GRANTED"
                  ? { expiresAt: new Date(expires).toISOString() }
                  : {}),
              }
            : { action, reason };
      const evidence = { ...base, ...fields };
      const signature = JSON.stringify(evidence);
      if (pending.current?.signature !== signature)
        pending.current = { signature, requestId: crypto.randomUUID() };
      const result = await resultOf(
        await fetch("/api/internal/operations/review/evidence", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-aps-internal-key": supplied,
          },
          body: JSON.stringify({
            acknowledged: true,
            evidence: { ...evidence, requestId: pending.current.requestId },
          }),
        }),
      );
      setNotice(
        `Evidence saved${result.replayed ? " (existing submission reused)" : ""}. Record ${result.evidenceId}. Run a new review to see the current result.`,
      );
      setAck(false);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Save failed. Keep the fields unchanged to retry the same submission.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="page-shell">
      <nav className={styles.nav}>
        <Link href="/operations">← Operations</Link>
        <span>Outreach remains off</span>
      </nav>
      <header>
        <p className="eyebrow">OPERATOR REVIEW</p>
        <h1>Review before action.</h1>
        <p className="hero-copy">
          Check what is missing and record evidence you have verified. Passing a
          review never enables sending.
        </p>
      </header>
      {error ? (
        <div className="notice error" role="alert">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="notice success" role="status">
          {notice}
        </div>
      ) : null}
      <section className="form-section">
        <h2>{page?.campaign.name ?? "Campaign contacts"}</h2>
        <p className="microcopy">
          Campaign {campaignId}. Contact details are masked. Use the permanent
          IDs to match your controlled evidence records.
        </p>
        {busy ? <p role="status">Working…</p> : null}
        {page ? (
          <>
            <div className={styles.fields}>
              <label>
                Contact
                <select
                  disabled={busy}
                  value={contactId}
                  onChange={(e) => {
                    setContactId(e.target.value);
                    clearDecision();
                    const c = page.contacts.find(
                      (c) => c.id === e.target.value,
                    );
                    setChannel(
                      c?.type === "EMAIL"
                        ? "EMAIL"
                        : c?.type === "MOBILE"
                          ? "SMS"
                          : "CALL",
                    );
                  }}
                >
                  <option value="">Choose a contact</option>
                  {page.contacts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label} · {words(c.type)} · lead {c.leadId.slice(0, 8)}{" "}
                      · contact {c.id.slice(0, 8)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Channel
                <select
                  value={channel}
                  disabled={busy}
                  onChange={(e) => {
                    setChannel(e.target.value as Channel);
                    clearDecision();
                  }}
                >
                  <option value="SMS">SMS</option>
                  <option value="CALL">Call</option>
                  <option value="EMAIL">Email</option>
                </select>
              </label>
            </div>
            {contact ? (
              <p className="microcopy">
                Lead ID: {contact.leadId}
                <br />
                Contact ID: {contact.id}
                <br />
                Lead status: {words(contact.leadStatus)} · Contact validity:{" "}
                {contact.isValid === null
                  ? "unverified"
                  : contact.isValid
                    ? "valid"
                    : "invalid"}
              </p>
            ) : null}
            {!page.contacts.length ? (
              <p>
                No enrolled contacts on this page. Source and enrich a lead
                before review.
              </p>
            ) : null}
            <div className={styles.actions}>
              <button
                className="primary-button"
                disabled={busy || !contact}
                onClick={() => void evaluate()}
              >
                Run readiness review
              </button>
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => void load()}
              >
                First page / refresh
              </button>
              {page.nextCursor ? (
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => void load(page.nextCursor!)}
                >
                  Next 50 contacts
                </button>
              ) : null}
            </div>
          </>
        ) : (
          <p className="microcopy">
            If access has expired, return to operations and sign in.
          </p>
        )}
        {decision ? (
          <div className={styles.result} role="status">
            <h3>
              {decision.reviewStatus === "BLOCKED"
                ? "Blocked — evidence or setup is missing"
                : "Ready for operator review"}
            </h3>
            {decision.reasons.length ? (
              <ul>
                {decision.reasons.map((r) => (
                  <li key={r}>{words(r)}</li>
                ))}
              </ul>
            ) : (
              <p>
                Current evidence checks passed. This is not legal clearance or
                permission to contact this person.
              </p>
            )}
            <p>
              Outreach disabled · Evaluated{" "}
              {new Date(decision.evaluatedAt).toLocaleString()}
            </p>
          </div>
        ) : null}
      </section>
      {contact ? (
        <section className="form-section">
          <p className="eyebrow">DOCUMENTED EVIDENCE ONLY</p>
          <h2>Record a review result</h2>
          <p className="hero-copy">
            Record the source result as it was received. An unknown result is
            not a pass. Use an opaque evidence reference, not contact details,
            documents, or credentials.
          </p>
          <form onSubmit={save}>
            <fieldset disabled={busy} className={styles.form}>
              <div className={styles.fields}>
                <label>
                  Action
                  <select
                    value={action}
                    onChange={(e) => {
                      setAction(e.target.value);
                      setAck(false);
                    }}
                  >
                    <option value="CHECK">Verification result</option>
                    <option value="CONSENT">Consent record</option>
                    <option value="SUPPRESS">Suppress contact</option>
                  </select>
                </label>
                {action === "CHECK" ? (
                  <>
                    <label>
                      Check
                      <select
                        value={check}
                        onChange={(e) => {
                          setCheck(e.target.value);
                          setAck(false);
                        }}
                      >
                        {checkSchema.options.map((c) => (
                          <option key={c} value={c}>
                            {words(c)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Result
                      <select
                        value={outcome}
                        onChange={(e) => {
                          setOutcome(e.target.value);
                          setAck(false);
                        }}
                      >
                        <option value="UNKNOWN">Unknown</option>
                        <option value="FAIL">Fail</option>
                        <option value="PASS">
                          Pass — supported by evidence
                        </option>
                      </select>
                    </label>
                  </>
                ) : action === "CONSENT" ? (
                  <label>
                    Consent status
                    <select
                      value={consent}
                      onChange={(e) => {
                        setConsent(e.target.value);
                        setAck(false);
                      }}
                    >
                      <option value="REVOKED">Revoked / opted out</option>
                      <option value="GRANTED">
                        Granted — supported by evidence
                      </option>
                    </select>
                  </label>
                ) : (
                  <label>
                    Suppression reason
                    <select
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    >
                      {[
                        "OPT_OUT",
                        "DNC",
                        "WRONG_NUMBER",
                        "COMPLAINT",
                        "INVALID_CONTACT",
                        "INTERNAL",
                        "LEGAL",
                        "OTHER",
                      ].map((r) => (
                        <option key={r} value={r}>
                          {words(r)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label>
                  Operator reference
                  <input
                    value={actor}
                    onChange={(e) => setActor(e.target.value)}
                    required
                    maxLength={100}
                    placeholder="Your internal operator ID"
                  />
                </label>
                <label>
                  Evidence reference
                  <input
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    required
                    maxLength={200}
                    placeholder="Controlled record or case ID"
                  />
                </label>
                <label>
                  Observed at (your local time)
                  <input
                    type="datetime-local"
                    value={observed}
                    onChange={(e) => setObserved(e.target.value)}
                    required
                  />
                </label>
                {action === "CHECK" ||
                (action === "CONSENT" && consent === "GRANTED") ? (
                  <label>
                    Expires at (your local time)
                    <input
                      type="datetime-local"
                      value={expires}
                      onChange={(e) => setExpires(e.target.value)}
                      required
                    />
                  </label>
                ) : null}
              </div>
              {action === "SUPPRESS" ||
              (action === "CONSENT" && consent === "REVOKED") ? (
                <p className="compliance-note">
                  This adds a persistent suppression for this contact value
                  across this customer’s campaigns and channels. A later consent
                  grant does not remove it.
                </p>
              ) : null}
              <label className={styles.ack}>
                <input
                  type="checkbox"
                  checked={ack}
                  onChange={(e) => setAck(e.target.checked)}
                  required
                />
                I verified the evidence matches this lead, contact, campaign,
                and channel, and understand this records an audit event.
              </label>
              <label>
                APS internal key — required to save
                <input
                  type="password"
                  autoComplete="off"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  required
                  maxLength={512}
                />
              </label>
              <button
                className="primary-button"
                disabled={busy || !ack || !key}
              >
                Save evidence record
              </button>
              <p className="microcopy">
                The key is cleared after submission. To retry a failed request,
                leave its evidence fields unchanged. Records are append-only;
                this page cannot remove suppressions.
              </p>
            </fieldset>
          </form>
        </section>
      ) : null}
      <section className="form-section">
        <p className="eyebrow">CONNECTIONS STILL NEEDED</p>
        <h2>Verification sources</h2>
        <ul className={styles.providers}>
          {verificationRequirements.map((p) => (
            <li key={p.capability}>
              <strong>
                {p.name} · {words(p.status)}
              </strong>
              <p>{p.required}</p>
            </li>
          ))}
        </ul>
        <p className="microcopy">
          BatchData property or contact data does not establish consent. No
          verification provider calls are made from this page.
        </p>
      </section>
    </main>
  );
}
