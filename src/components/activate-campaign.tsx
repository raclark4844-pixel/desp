"use client";

import { useRef, useState } from "react";
import type { CampaignPreparation } from "@/lib/campaign-preparation";

export function ActivateCampaign({
  campaignId,
  name,
  onRefresh,
}: {
  campaignId: string;
  name: string;
  onRefresh: () => void;
}) {
  const [preparation, setPreparation] = useState<CampaignPreparation | null>(
    null,
  );
  const [confirmed, setConfirmed] = useState(false);
  const [setupAcknowledged, setSetupAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const pending = useRef(false);
  async function review() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    setConfirmed(false);
    setSetupAcknowledged(false);
    setPreparation(null);
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/prepare`, {
        cache: "no-store",
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Unable to load the checklist.");
      setPreparation(result.result);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to load the checklist.",
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  async function activate() {
    if (
      !confirmed ||
      !preparation?.messagesReady ||
      (preparation.setupPending && !setupAcknowledged) ||
      pending.current
    )
      return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/activate`, {
        method: "POST",
        headers: {
          "x-confirm-lead-collection": "yes",
          "x-campaign-review": preparation.reviewToken,
          "x-acknowledge-sending-setup": setupAcknowledged ? "yes" : "no",
        },
      });
      const result = await response.json();
      if (!response.ok || !result.ok)
        throw new Error(result.error || "Unable to activate lead collection.");
      setMessage(
        "Lead collection is queued or already started. Check sourcing jobs below for progress and any setup or manual-import steps. No campaign messages were approved or sent by this action.",
      );
      setPreparation(null);
    } catch (e) {
      setConfirmed(false);
      setError(
        e instanceof Error
          ? e.message
          : "The result could not be confirmed. Refresh campaign status before trying again.",
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <section
      className="form-section"
      aria-label="Prepare campaign before collecting leads"
    >
      <h3>Before collecting leads: prepare and confirm</h3>
      <p>
        Campaign: <strong>{name}</strong>
      </p>
      {message ? (
        <>
          <p role="status">{message}</p>
          <button className="secondary-button" onClick={onRefresh}>
            Refresh campaign status
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={() => void review()}
          >
            {busy
              ? "Please wait…"
              : preparation
                ? "Reload checklist after changes"
                : "Review messages & sending checklist"}
          </button>
          {preparation && (
            <>
              <p>
                <strong>{preparation.customerName}</strong> ·{" "}
                {preparation.industry} · Requested leads:{" "}
                {preparation.desiredLeadCount ?? "Not specified"}
              </p>
              <p>
                Territory:{" "}
                {preparation.territories.join("; ") || "Not specified"}
              </p>
              <details>
                <summary>Review targeting criteria</summary>
                <pre
                  style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
                >
                  {JSON.stringify(preparation.targeting, null, 2)}
                </pre>
              </details>
              {!preparation.messages.length && (
                <p>
                  No delivery channels are selected. Confirming this campaign
                  collects leads only; no outreach is planned.
                </p>
              )}
              {preparation.messages.map((m) => (
                <section className="form-section" key={m.channel}>
                  <h4>
                    {m.label} — {m.ready ? "Message saved" : "Action required"}
                  </h4>
                  <p>
                    Sender: {m.sender}
                    {m.replyTo ? ` · Reply-to: ${m.replyTo}` : ""}
                  </p>
                  {m.subject && <p>Subject: {m.subject}</p>}
                  <p
                    style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
                  >
                    {m.preview}
                  </p>
                  {m.channel === "CALL" && (
                    <p>
                      This is the employee’s script. The employee answers first
                      and presses 1 to connect to the prospect; no automated
                      voice reads this script.
                    </p>
                  )}
                  <p>
                    Mailing address: {m.mailingAddress || "Required"}
                    <br />
                    Audience timezone: {m.timezone || "Required"}
                  </p>
                  <a
                    className="secondary-button"
                    href={`/sending?campaignId=${campaignId}&channel=${m.channel}`}
                  >
                    {m.ready
                      ? "Review / edit message"
                      : "Write message / call script"}
                  </a>
                  {m.setup.length ? (
                    <>
                      <h4>Still needed before sending</h4>
                      <ul>
                        {m.setup.map((s) => (
                          <li key={s}>{s}</li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <p>
                      Provider configuration checks passed. Recipient review and
                      final sending approval are still required.
                    </p>
                  )}
                </section>
              ))}
              <p>
                <a href="/inbox">
                  Open Inbox campaign settings to assign the texting number
                </a>
              </p>
              <h4>Required after leads are collected</h4>
              <p>
                Review actual contacts, consent, opt-outs, applicable DNC and
                reassigned-number checks, and contact eligibility. Then review
                the final audience and approve delivery in Campaign Sending.
                Collection approval does not approve outreach.
              </p>
              <p>
                Delivery is restricted to weekdays, 10 AM–6 PM in the audience
                timezone. The recipient review must confirm the appropriate
                local requirements.
              </p>
              {!preparation.messagesReady && (
                <p role="status">
                  Save every selected channel’s message, mailing address, and
                  audience timezone, then reload this checklist to continue.
                </p>
              )}
              <form
                className="employee-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void activate();
                }}
              >
                {preparation.setupPending && (
                  <label>
                    <input
                      type="checkbox"
                      checked={setupAcknowledged}
                      disabled={busy}
                      onChange={(e) => setSetupAcknowledged(e.target.checked)}
                      required
                    />{" "}
                    I reviewed the missing sending setup above. I am collecting
                    leads only and will complete setup before sending.
                  </label>
                )}
                <label>
                  <input
                    type="checkbox"
                    checked={confirmed}
                    disabled={busy || !preparation.messagesReady}
                    onChange={(e) => setConfirmed(e.target.checked)}
                    required
                  />{" "}
                  I confirm the customer, targeting, messages or scripts, sender
                  details, mailing address, timezone, and any listed outstanding
                  requirements. I approve lead collection and applicable
                  provider data charges.
                </label>
                <p>
                  API property data is prioritized when configured. PropWire may
                  require manual export and import. Provider charges follow your
                  account plan; the requested lead count is not guaranteed.
                </p>
                <button
                  className="primary-button"
                  disabled={
                    busy ||
                    !confirmed ||
                    !preparation.messagesReady ||
                    (preparation.setupPending && !setupAcknowledged)
                  }
                >
                  {busy
                    ? "Queuing lead collection…"
                    : "Activate / Collect Leads"}
                </button>
              </form>
            </>
          )}
          {error && <p role="alert">{error}</p>}
        </>
      )}
    </section>
  );
}
