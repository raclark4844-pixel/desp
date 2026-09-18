"use client";
import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
export function BillingForm({
  action,
  customerId,
  campaignId,
  children,
}: {
  action: "SETTINGS" | "COST" | "RATES";
  customerId?: string;
  campaignId?: string;
  children: ReactNode;
}) {
  const [busy, setBusy] = useState(false),
    [note, setNote] = useState(""),
    [id, setId] = useState(() => crypto.randomUUID());
  const router = useRouter();
  return (
    <form
      className="billing-form"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const f = Object.fromEntries(new FormData(form));
        setBusy(true);
        setNote("");
        try {
          const payload =
            action === "SETTINGS"
              ? {
                  action,
                  customerId,
                  email: f.email,
                  enabled: f.enabled === "on",
                  thirdEmail: f.thirdEmail,
                }
              : action === "COST"
                ? { ...f, action, campaignId, id }
                : {
                    action,
                    campaignId,
                    rates: Object.fromEntries(
                      Object.entries(f)
                        .filter(([, v]) => v !== "")
                        .map(([k, v]) => [k, Number(v)]),
                    ),
                  };
          const r = await fetch("/api/billing", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          const b = await r.json();
          if (!r.ok) throw Error(b.error);
          setNote("Saved.");
          if (action === "COST") {
            setId(crypto.randomUUID());
            form.reset();
          }
          router.refresh();
        } catch (e) {
          setNote(e instanceof Error ? e.message : "Could not save.");
        } finally {
          setBusy(false);
        }
      }}
    >
      {children}
      <button disabled={busy}>{busy ? "Saving…" : "Save"}</button>
      <p role="status">{note}</p>
    </form>
  );
}
