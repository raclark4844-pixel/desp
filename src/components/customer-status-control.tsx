"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import {
  customerStatusDescriptions,
  customerStatusLabel,
  customerStatusValues,
  type CustomerStatusValue,
} from "@/lib/customer-status";

export function CustomerStatusControl({
  customerId,
  initialStatus,
  updatedAt: initialUpdatedAt,
  isAdmin,
}: {
  customerId: string;
  initialStatus: CustomerStatusValue;
  updatedAt: string;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<CustomerStatusValue>(initialStatus);
  const [updatedAt, setUpdatedAt] = useState(initialUpdatedAt);
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  if (!isAdmin) {
    return (
      <section className="form-section">
        <p className="eyebrow">CUSTOMER STATUS</p>
        <h2>{customerStatusLabel(initialStatus)}</h2>
        <p className="hero-copy">{customerStatusDescriptions[initialStatus]}</p>
        <p className="microcopy">Only an administrator can change customer lifecycle status.</p>
      </section>
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch(`/api/customers/${customerId}/status`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status, reason, updatedAt }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to change customer status.");
      setUpdatedAt(result.updatedAt);
      setReason("");
      setNotice(
        result.pausedCampaigns
          ? `Status updated. ${result.pausedCampaigns} active campaign(s) were paused.`
          : "Customer status updated.",
      );
      router.refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to change customer status.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form-section" onSubmit={submit}>
      <p className="eyebrow">CUSTOMER STATUS</p>
      <h2>{customerStatusLabel(status)}</h2>
      <p className="hero-copy">{customerStatusDescriptions[status]}</p>
      {notice ? <p className="notice" role="status">{notice}</p> : null}
      <div className="field-grid two-column">
        <label>
          Status
          <select value={status} onChange={(event) => setStatus(event.target.value as CustomerStatusValue)}>
            {customerStatusValues.map((value) => (
              <option value={value} key={value}>{customerStatusLabel(value)}</option>
            ))}
          </select>
        </label>
        <label>
          Reason for change
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            minLength={3}
            maxLength={500}
            required
            placeholder="Example: customer requested a temporary pause"
          />
        </label>
      </div>
      <button className="primary-button" disabled={busy}>
        {busy ? "Updating…" : "Update status"}
      </button>
      <p className="microcopy">
        Non-active statuses block new campaign activation. Ready or running campaigns are paused; reactivating a customer does not automatically restart them.
      </p>
    </form>
  );
}
