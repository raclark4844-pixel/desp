"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
type State = {
  decided: boolean;
  enabled: boolean;
  configured: boolean;
  expiresAt: string;
  reviewed: number;
};
export function AiSession() {
  const path = usePathname(),
    [state, setState] = useState<State | null>(null),
    [open, setOpen] = useState(false),
    [checked, setChecked] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null),
    monitoring = useRef(false);
  const privatePage = path !== "/" && path !== "/login";
  useEffect(() => {
    if (!privatePage) {
      setState(null);
      setOpen(false);
      return;
    }
    let alive = true;
    async function load() {
      try {
        const r = await fetch("/api/employee/ai-session", {
          cache: "no-store",
        });
        if (!r.ok) {
          if (alive) setState(null);
          return;
        }
        const b = await r.json();
        if (alive) {
          setState(b.result);
          if (!b.result.decided) setOpen(true);
        }
      } catch {
        /* Fail closed; no monitoring without a server-confirmed session. */
      }
    }
    void load();
    const timer = setInterval(load, 30000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [path, privatePage]);
  useEffect(() => {
    if (open && state) {
      dialog.current?.showModal();
      setChecked(false);
    } else dialog.current?.close();
  }, [open, !!state]);
  useEffect(() => {
    if (!state?.enabled || !state.configured || !privatePage) return;
    let alive = true;
    async function monitor() {
      if (monitoring.current || document.visibilityState !== "visible") return;
      monitoring.current = true;
      try {
        const r = await fetch("/api/employee/ai-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "MONITOR" }),
        });
        const b = await r.json();
        if (!r.ok && alive) setError(b.error || "Monitoring paused.");
        if (r.ok && alive && b.result?.status === "COMPLETE")
          setState((s) => (s ? { ...s, reviewed: s.reviewed + 1 } : s));
      } catch {
        if (alive) setError("Monitoring connection interrupted.");
      } finally {
        monitoring.current = false;
      }
    }
    void monitor();
    const timer = setInterval(monitor, 60000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [state?.enabled, state?.configured, privatePage]);
  async function decide(enabled: boolean) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/employee/ai-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "CONSENT", enabled, confirm: true }),
      });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error);
      setState(b.result);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  if (!state) return null;
  return (
    <>
      <div className="ai-session-bar">
        <span>
          AI for this session:{" "}
          {state.enabled
            ? state.configured
              ? `Monitoring · ${state.reviewed} reviewed`
              : "Allowed · awaiting OpenAI setup"
            : "Off"}
        </span>
        <button onClick={() => setOpen(true)}>AI session settings</button>
        {state.enabled && (
          <button disabled={busy} onClick={() => decide(false)}>
            Stop monitoring
          </button>
        )}
        {error && <span role="status">{error}</span>}
      </div>
      <dialog
        ref={dialog}
        className="ai-session-dialog"
        onCancel={(e) => {
          e.preventDefault();
          if (state.decided) setOpen(false);
        }}
        aria-labelledby="ai-session-title"
      >
        <h2 id="ai-session-title">
          Allow AI assistance for this login session?
        </h2>
        <p>
          OpenAI can review new text and email conversations in this AP Spartan
          workspace, including recent message history, and prepare drafts and
          suggested business answers.
        </p>
        <p>
          Messages may contain personal information. This covers this app’s
          communications only—not your phone, microphone, other apps, or
          unrecorded calls. Monitoring runs while this workspace is open and
          visible and ends when you stop it, sign out, or your session expires.
        </p>
        <p>
          Drafts need employee review before sending. Suggested answers need
          administrator approval before reuse. This does not authorize model
          training or automatic sending. Data already sent to OpenAI cannot be
          recalled by stopping monitoring.
        </p>
        {!state.configured && (
          <p>
            OpenAI is not connected yet. Your choice will apply to this session
            if setup is completed.
          </p>
        )}
        <label className="ai-session-check">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
          />
          I understand and allow monitoring and drafts for this session.
        </label>
        {error && <p role="alert">{error}</p>}
        <div className="ai-session-actions">
          <button disabled={busy || !checked} onClick={() => decide(true)}>
            Confirm for this session
          </button>
          <button disabled={busy} onClick={() => decide(false)}>
            Continue without AI
          </button>
          {state.decided && (
            <button onClick={() => setOpen(false)}>Close</button>
          )}
        </div>
        <p>
          <small>
            Automatic sending: unavailable. It requires a separate administrator
            setup and safeguards.
          </small>
        </p>
      </dialog>
    </>
  );
}
