"use client";
import { useState, type FormEvent } from "react";
import { profileFields, type ProfileFields } from "@/lib/customer-profile";
type Customer = { id: string; name: string; websiteUrl: string | null; contactName: string | null; contactEmail: string | null; timezone: string; updatedAt: string; profile: ProfileFields };
export function CustomerProfileForm({ customer }: { customer: Customer }) {
  const [updatedAt, setUpdatedAt] = useState(customer.updatedAt), [notice, setNotice] = useState(""), [busy, setBusy] = useState(false);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setNotice(""); const data = new FormData(event.currentTarget);
    try {
      const response = await fetch(`/api/customers/${customer.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ updatedAt, ...Object.fromEntries(["name", "websiteUrl", "contactName", "contactEmail", "timezone"].map(key => [key, data.get(key)])), profile: Object.fromEntries(Object.keys(profileFields).map(key => [key, data.get(key)])) }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      setUpdatedAt(result.updatedAt); setNotice("Customer information saved.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Unable to save customer."); } finally { setBusy(false); }
  }
  return <form onSubmit={save} className="form-section">
    {notice && <p className="notice" role="status">{notice}</p>}
    <div className="field-grid two-column">
      <label>Company name<input name="name" defaultValue={customer.name} required minLength={2} maxLength={160} /></label>
      <label>Website<input name="websiteUrl" type="url" defaultValue={customer.websiteUrl ?? ""} maxLength={500} /></label>
      <label>Primary contact<input name="contactName" defaultValue={customer.contactName ?? ""} maxLength={120} /></label>
      <label>Contact email<input name="contactEmail" type="email" defaultValue={customer.contactEmail ?? ""} maxLength={320} /></label>
      <label>Time zone<input name="timezone" defaultValue={customer.timezone} required maxLength={80} /></label>
      {Object.entries(profileFields).map(([key, label]) => <label key={key}>{label}{["services", "serviceAreas", "notes"].includes(key) ? <textarea name={key} rows={key === "notes" ? 6 : 3} defaultValue={customer.profile[key as keyof ProfileFields]} maxLength={key === "notes" ? 6000 : 2000} /> : <input name={key} defaultValue={customer.profile[key as keyof ProfileFields]} />}</label>)}
    </div><button className="primary-button" disabled={busy}>{busy ? "Saving…" : "Save customer"}</button>
    <p className="microcopy">Saving updates this customer’s master record. Existing campaigns keep their customer ID. No messages are sent.</p>
  </form>;
}
