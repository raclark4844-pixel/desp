"use client";

import { useRef, useState } from "react";

export function ActivateCampaign({
  campaignId,
  name,
  onRefresh,
}: {
  campaignId: string;
  name: string;
  onRefresh: () => void;
}) {
  const [review, setReview] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const pending = useRef(false);
  async function activate() {
    if (!confirmed || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/activate`, {
        method: "POST",
        headers: { "x-confirm-lead-collection": "yes" },
      });
      const result = await response.json();
      if (!response.ok || !result.ok)
        throw new Error(result.error || "Unable to activate lead collection.");
      setMessage(
        "Lead collection is queued or already started. Check sourcing jobs below for progress and any setup or manual-import steps. No campaign messages were approved or sent by this action.",
      );
      setReview(false);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "The result could not be confirmed. Refresh status before trying again.",
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="form-section" aria-label="Activate lead collection">
      <h3>Next step: collect leads</h3>
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
          {!review ? (
            <button className="primary-button" onClick={() => setReview(true)}>
              Activate / Collect Leads
            </button>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void activate();
              }}
            >
              <p>
                Review the customer, territory, targeting, and requested lead
                count before continuing. This queues collection through the
                configured provider, prioritizing API property data when
                available. PropWire may require a manual export and import.
              </p>
              <p>
                Provider data charges may apply under your account’s plan.
                Activation does not guarantee a particular number of leads.
                Sending requires separate message preparation, approval, and
                recipient checks.
              </p>
              <label>
                <input
                  type="checkbox"
                  checked={confirmed}
                  disabled={busy}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  required
                />{" "}
                I reviewed this campaign and approve lead collection and any
                applicable provider charges.
              </label>
              <div className="home-actions">
                <button
                  className="primary-button"
                  disabled={busy || !confirmed}
                >
                  {busy
                    ? "Queuing lead collection…"
                    : "Confirm & collect leads"}
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => {
                    setReview(false);
                    setConfirmed(false);
                    setError("");
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
          {error && (
            <p role="alert">
              {error} Refresh campaign status to check whether collection was
              queued before retrying.
            </p>
          )}
        </>
      )}
    </section>
  );
}
