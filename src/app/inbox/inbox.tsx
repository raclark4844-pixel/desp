"use client";
import { useEffect, useState, useCallback, type FormEvent } from "react";
type Campaign = {
  id: string;
  name: string;
  customerId: string;
  smsSenderId: string | null;
  primaryAlertTargetId: string | null;
  customer: { contactName: string | null; profile: { phone?: string } | null };
};
type Employee = { id: string; name: string; email: string };
type Conversation = {
  id: string;
  channel: string;
  status: string;
  assignedTo: string | null;
  needsReply: boolean;
  updatedAt: string;
  fromNumber: string | null;
  campaign: { name: string };
  contact: { normalizedValue: string };
  lead: {
    firstName: string | null;
    lastName: string | null;
    companyName: string | null;
  };
};
type Reply = {
  id: string;
  body: string;
  status: string;
  reason: string | null;
};
type Detail = Conversation & {
  handoff: {
    target: { id: string; name: string; phone: string } | null;
    sourceMessageId: string | null;
    fields: {
      name: string;
      address: string;
      phone: string;
      email: string;
      service: string;
    };
    alerts: {
      id: string;
      status: string;
      body: string | null;
      createdAt: string;
    }[];
  };
  aiObservations: {
    id: string;
    status: string;
    summary: string | null;
    question: string | null;
    answer: string | null;
    knowledgeStatus: string;
  }[];
  messages: {
    id: string;
    body: string;
    direction: string;
    createdAt: string;
    status: string;
  }[];
  replies: Reply[];
};
type Target = {
  id: string;
  campaignId: string;
  employeeId: string | null;
  kind: string;
  name: string | null;
  channel: string;
  destination: string;
  enabled: boolean;
};
type Overview = {
  conversations: Conversation[];
  nextCursor: string | null;
  campaigns: Campaign[];
  employees: Employee[];
  senders: { id: string; phone: string; label: string; customerId: string }[];
  targets: Target[];
  knowledge: {
    id: string;
    campaignId: string;
    question: string;
    answer: string;
  }[];
  unmatched: {
    key: string;
    sender: string;
    destination: string;
    body: string;
    reason: string;
  }[];
  notifications: { status: string; _count: number }[];
  aiConfigured: boolean;
  notificationsEnabled: boolean;
  liveEnabled: boolean;
};
async function api(query: string, body?: unknown) {
  const r = await fetch(
    `/api/inbox${query}`,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : { cache: "no-store" },
  );
  const b = await r.json();
  if (!r.ok) throw new Error(b.error || "Request failed.");
  return b.result;
}
const name = (c: Conversation) =>
  [c.lead.firstName, c.lead.lastName].filter(Boolean).join(" ") ||
  c.lead.companyName ||
  c.contact.normalizedValue;
export default function Inbox({ admin }: { admin: boolean }) {
  const [data, setData] = useState<Overview | null>(null),
    [campaign, setCampaign] = useState(""),
    [selected, setSelected] = useState(""),
    [conversation, setConversation] = useState<Detail | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [draft, setDraft] = useState(""),
    [review, setReview] = useState(""),
    [tab, setTab] = useState("conversations"),
    [cursor, setCursor] = useState("");
  const refresh = useCallback(
    async () => setData(await api(`?campaign=${campaign}&cursor=${cursor}`)),
    [campaign, cursor],
  );
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("conversation");
    if (id) setSelected(id);
  }, []);
  useEffect(() => {
    let alive = true;
    const load = () =>
      api(`?campaign=${campaign}&cursor=${cursor}`)
        .then((d) => {
          if (alive) setData(d);
        })
        .catch((e) => {
          if (alive) setError(e.message);
        });
    void load();
    const timer = setInterval(load, 20000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [campaign, cursor]);
  useEffect(() => {
    setConversation(null);
    setDraft("");
    setReview("");
    if (!selected) return;
    let alive = true;
    const load = () =>
      api(`?id=${selected}`)
        .then((d) => {
          if (alive) setConversation(d);
        })
        .catch((e) => {
          if (alive) setError(e.message);
        });
    void load();
    const timer = setInterval(load, 20000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [selected]);
  useEffect(() => {
    setReview("");
  }, [conversation?.updatedAt]);
  async function change(action: string, payload: unknown) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api("", { action, payload });
      await refresh();
      if (selected) setConversation(await api(`?id=${selected}`));
      setReview("");
      setNotice(
        typeof result === "object" && result?.note
          ? result.note
          : action === "SEND"
            ? `Reply status: ${result}`
            : action === "HANDOFF"
              ? `Lead delivery status: ${result?.status ?? "PENDING"}. Pending means queued, not sent.`
              : "Saved.",
      );
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }
  function form(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    return Object.fromEntries(new FormData(e.currentTarget));
  }
  if (!data) return <p role="status">{error || "Loading inbox…"}</p>;
  const currentCampaign = data.campaigns.find((c) => c.id === campaign);
  return (
    <>
      <div className="inbox-banner">
        {data.liveEnabled
          ? "Sending still requires channel setup and contact eligibility."
          : "Live sending is off. You can organize conversations and prepare replies."}{" "}
        AI drafts always require employee review.
      </div>
      <div className="inbox-toolbar">
        <label>
          Campaign
          <select
            value={campaign}
            onChange={(e) => {
              setCampaign(e.target.value);
              setCursor("");
              setSelected("");
            }}
          >
            <option value="">All campaigns</option>
            {data.campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <button onClick={() => refresh().catch((e) => setError(e.message))}>
          Refresh
        </button>
        <button
          onClick={() => setTab("conversations")}
          aria-pressed={tab === "conversations"}
        >
          Conversations
        </button>
        <button
          onClick={() => setTab("settings")}
          aria-pressed={tab === "settings"}
        >
          Campaign settings
        </button>
      </div>
      {error && (
        <p role="alert" className="inbox-error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {tab === "conversations" ? (
        <div className="inbox-grid">
          <aside aria-label="Conversations">
            <h2>Team inbox</h2>
            {!data.conversations.length && (
              <p>
                No conversations yet. Replies will appear here once a campaign
                starts sending.
              </p>
            )}
            {data.conversations.map((c) => (
              <button
                className={`inbox-thread ${selected === c.id ? "selected" : ""}`}
                key={c.id}
                onClick={() => setSelected(c.id)}
              >
                <strong>{name(c)}</strong>
                <span>
                  {c.campaign.name} · {c.channel}
                </span>
                <span>
                  {c.needsReply ? "Needs reply" : c.status} ·{" "}
                  {c.assignedTo
                    ? data.employees.find((e) => e.id === c.assignedTo)?.name ||
                      "Assigned"
                    : "Unassigned"}
                </span>
              </button>
            ))}
            {cursor && (
              <button onClick={() => setCursor("")}>
                Newest conversations
              </button>
            )}
            {data.nextCursor && (
              <button onClick={() => setCursor(data.nextCursor!)}>
                Older conversations
              </button>
            )}
          </aside>
          <section className="inbox-detail" aria-label="Conversation">
            {conversation ? (
              <>
                <h2>{name(conversation)}</h2>
                <p>
                  {conversation.contact.normalizedValue} ·{" "}
                  {conversation.channel}
                  {conversation.fromNumber &&
                    ` · From ${conversation.fromNumber}`}
                </p>
                <form
                  key={
                    conversation.id +
                    conversation.assignedTo +
                    conversation.status
                  }
                  onSubmit={(e) => {
                    const f = form(e);
                    void change("ASSIGN", {
                      id: conversation.id,
                      assignedTo: f.assignedTo || null,
                      status: f.status,
                      expectedUpdatedAt: conversation.updatedAt,
                    });
                  }}
                >
                  <div className="inbox-toolbar">
                    <label>
                      Assigned employee
                      <select
                        name="assignedTo"
                        defaultValue={conversation.assignedTo || ""}
                      >
                        <option value="">Unassigned</option>
                        {data.employees.map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Status
                      <select name="status" defaultValue={conversation.status}>
                        {[
                          "OPEN",
                          "WAITING",
                          "QUALIFIED",
                          "CLOSED",
                          "ESCALATED",
                        ].map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </select>
                    </label>
                    <button disabled={busy}>Save handoff</button>
                  </div>
                </form>
                <p className="microcopy">
                  Campaign automation stays paused for this person after a
                  reply, including when a conversation is closed. Opt-outs
                  remain blocked.
                </p>
                <div className="inbox-messages">
                  {[...conversation.messages].reverse().map((m) => (
                    <article
                      key={m.id}
                      className={`inbox-message ${m.direction.toLowerCase()}`}
                    >
                      <small>
                        {m.direction === "INBOUND" ? "Contact" : "AP Spartan"} ·{" "}
                        {new Date(m.createdAt).toLocaleString()} · {m.status}
                      </small>
                      <p>{m.body}</p>
                    </article>
                  ))}
                  {conversation.messages.length === 200 && (
                    <p>Showing the latest 200 messages.</p>
                  )}
                </div>
                <details className="inbox-draft">
                  <summary>Send qualified lead to campaign contact</summary>
                  {conversation.handoff.target &&
                  conversation.handoff.sourceMessageId ? (
                    <form
                      key={
                        conversation.id +
                        conversation.handoff.target.id +
                        conversation.handoff.target.phone +
                        conversation.handoff.sourceMessageId
                      }
                      onSubmit={(e) => {
                        const f = form(e);
                        void change("HANDOFF", {
                          conversationId: conversation.id,
                          targetId: conversation.handoff.target!.id,
                          expectedPhone: conversation.handoff.target!.phone,
                          sourceMessageId: conversation.handoff.sourceMessageId,
                          fields: {
                            name: f.name,
                            address: f.address,
                            phone: f.phone,
                            email: f.email,
                            service: f.service,
                          },
                          confirm: f.confirm === "on",
                        });
                      }}
                    >
                      <p>
                        Text to{" "}
                        <strong>{conversation.handoff.target.name}</strong> ·{" "}
                        {conversation.handoff.target.phone}
                      </p>
                      <p>
                        Review the prospect’s details below. Missing details
                        stay blank. Email is optional; the other fields are
                        required. Confirm the requested service from the
                        conversation.
                      </p>
                      {(
                        [
                          ["name", "Prospect name", 120],
                          ["address", "Property / service address", 250],
                          ["phone", "Prospect phone (+1…)", 12],
                          ["email", "Prospect email (optional)", 254],
                          ["service", "Service requested", 200],
                        ] as const
                      ).map(([key, label, max]) => (
                        <label key={key}>
                          {label}
                          <input
                            name={key}
                            defaultValue={conversation.handoff.fields[key]}
                            maxLength={max}
                            type={key === "email" ? "email" : "text"}
                            required={key !== "email"}
                          />
                        </label>
                      ))}
                      <p>
                        The text will include the campaign name and these five
                        fields. It goes to the campaign’s main customer contact
                        shown above.
                      </p>
                      <label className="inbox-check">
                        <input type="checkbox" name="confirm" required />I
                        confirmed the prospect wants this service, agreed to
                        share these details with the campaign contact, and I
                        reviewed the information and recipient.
                      </label>
                      <button disabled={busy}>
                        {data.notificationsEnabled
                          ? "Send lead by text"
                          : "Save lead for sending — texting is off"}
                      </button>
                    </form>
                  ) : (
                    <p>
                      An administrator must save the campaign’s main customer
                      contact and mobile number in Campaign settings. An
                      incoming response is also required.
                    </p>
                  )}
                  {conversation.handoff.alerts.map((a) => (
                    <p key={a.id}>
                      Lead delivery: {a.status} ·{" "}
                      {new Date(a.createdAt).toLocaleString()}
                    </p>
                  ))}
                </details>
                {!!conversation.aiObservations.length && (
                  <details className="inbox-draft">
                    <summary>
                      AI monitoring notes and learning suggestions
                    </summary>
                    {conversation.aiObservations.map((o) => (
                      <article key={o.id}>
                        <p>
                          <strong>{o.status}</strong> ·{" "}
                          {o.summary || "Review in progress"}
                        </p>
                        {o.question && o.answer && (
                          <>
                            <strong>{o.question}</strong>
                            <p>{o.answer}</p>
                            <p>
                              {o.knowledgeStatus === "APPROVED"
                                ? "Approved for future drafts"
                                : "Unapproved AI suggestion — check facts and remove personal details before reuse."}
                            </p>
                            {admin && o.knowledgeStatus !== "APPROVED" && (
                              <form
                                onSubmit={(e) => {
                                  e.preventDefault();
                                  void change("APPROVE_OBSERVATION", {
                                    id: o.id,
                                    confirm: true,
                                  });
                                }}
                              >
                                <label className="inbox-check">
                                  <input type="checkbox" required />I verified
                                  this reusable answer is accurate and contains
                                  no personal details.
                                </label>
                                <button disabled={busy}>
                                  Approve for future drafts
                                </button>
                              </form>
                            )}
                          </>
                        )}
                      </article>
                    ))}
                  </details>
                )}
                {["SMS", "EMAIL"].includes(conversation.channel) && (
                  <>
                    <label>
                      Your reply
                      <textarea
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        maxLength={conversation.channel === "SMS" ? 600 : 4000}
                        rows={4}
                      />
                    </label>
                    <div className="inbox-toolbar">
                      <button
                        disabled={busy || !draft.trim()}
                        onClick={async () => {
                          if (
                            await change("DRAFT", {
                              conversationId: conversation.id,
                              requestId: crypto.randomUUID(),
                              body: draft,
                            })
                          )
                            setDraft("");
                        }}
                      >
                        Save reply draft
                      </button>
                      <button
                        disabled={busy || !data.aiConfigured}
                        onClick={() => change("AI", { id: conversation.id })}
                      >
                        Suggest with OpenAI
                      </button>
                    </div>
                    {!data.aiConfigured && (
                      <p className="microcopy">
                        OpenAI is not connected yet. Manual replies and approved
                        answers can be prepared now.
                      </p>
                    )}
                    <h3>Reply drafts and delivery</h3>
                    {conversation.replies.map((r) => (
                      <article className="inbox-draft" key={r.id}>
                        <small>
                          {r.status}
                          {r.reason && ` — ${r.reason}`}
                        </small>
                        <p>{r.body}</p>
                        {r.status === "DRAFT" && (
                          <>
                            <button onClick={() => setDraft(r.body)}>
                              Copy into editor
                            </button>
                            <label className="inbox-check">
                              <input
                                type="checkbox"
                                checked={review === r.id}
                                onChange={(e) =>
                                  setReview(e.target.checked ? r.id : "")
                                }
                              />
                              I reviewed this exact reply and the conversation.
                            </label>
                            <button
                              disabled={
                                busy || review !== r.id || !data.liveEnabled
                              }
                              onClick={() =>
                                change("SEND", {
                                  id: r.id,
                                  confirm: true,
                                  expectedUpdatedAt: conversation.updatedAt,
                                })
                              }
                            >
                              Send reviewed reply
                            </button>
                          </>
                        )}
                      </article>
                    ))}
                  </>
                )}
              </>
            ) : (
              <p>
                Select a conversation to read messages, assign an employee or
                prepare a reply.
              </p>
            )}
          </section>
        </div>
      ) : (
        <section className="inbox-settings">
          <h2>Campaign settings</h2>
          {!currentCampaign ? (
            <p>
              Select a campaign above to configure its sender, alerts and
              approved answers.
            </p>
          ) : (
            <>
              <h3>Texting number</h3>
              <p>
                Select an owned, registered number for this campaign’s region.
                The number is locked once its texting batch is approved.
              </p>
              <form
                key={campaign + currentCampaign.smsSenderId}
                onSubmit={(e) => {
                  const f = form(e);
                  void change("ASSIGN_SENDER", {
                    campaignId: campaign,
                    senderId: f.senderId || null,
                  });
                }}
              >
                <label>
                  Campaign sender
                  <select
                    name="senderId"
                    defaultValue={currentCampaign.smsSenderId || ""}
                    disabled={!admin}
                  >
                    <option value="">Choose a texting number</option>
                    {data.senders
                      .filter(
                        (s) => s.customerId === currentCampaign.customerId,
                      )
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label} · {s.phone}
                        </option>
                      ))}
                  </select>
                </label>
                <button disabled={!admin || busy}>Save campaign number</button>
              </form>
              {admin && (
                <details>
                  <summary>Add an existing Twilio number</summary>
                  <p>
                    The app verifies membership in your Messaging Service. This
                    does not buy a number or complete carrier registration.
                  </p>
                  <form
                    onSubmit={(e) => {
                      const f = form(e);
                      void change("REGISTER_SENDER", {
                        campaignId: campaign,
                        phone: f.phone,
                        label: f.label,
                        confirmRegistration: f.confirm === "on",
                      });
                    }}
                  >
                    <label>
                      Phone number
                      <input name="phone" placeholder="+12025550123" required />
                    </label>
                    <label>
                      Region / label
                      <input
                        name="label"
                        placeholder="Campaign region"
                        required
                        maxLength={100}
                      />
                    </label>
                    <label className="inbox-check">
                      <input type="checkbox" name="confirm" required />I
                      verified this number’s registration and authorization for
                      this customer.
                    </label>
                    <button disabled={busy}>Verify and add number</button>
                  </form>
                </details>
              )}
              <h3>Campaign main contact — lead delivery</h3>
              <p>
                This is the customer/company contact who receives qualified
                leads by text, not an AP Spartan employee. Confirm their mobile
                number and permission to receive lead details.
              </p>
              <form
                key={campaign + currentCampaign.primaryAlertTargetId}
                onSubmit={(e) => {
                  const f = form(e);
                  void change("PRIMARY_CONTACT", {
                    campaignId: campaign,
                    name: f.name,
                    phone: f.phone,
                    confirm: f.confirm === "on",
                  });
                }}
              >
                <label>
                  Main contact name
                  <input
                    name="name"
                    required
                    disabled={!admin}
                    maxLength={120}
                    defaultValue={
                      data.targets.find(
                        (t) =>
                          t.id === currentCampaign.primaryAlertTargetId &&
                          t.kind === "CUSTOMER",
                      )?.name ||
                      currentCampaign.customer.contactName ||
                      ""
                    }
                  />
                </label>
                <label>
                  Main contact mobile (+1…)
                  <input
                    name="phone"
                    required
                    disabled={!admin}
                    placeholder="+15551234567"
                    defaultValue={
                      data.targets.find(
                        (t) =>
                          t.id === currentCampaign.primaryAlertTargetId &&
                          t.kind === "CUSTOMER",
                      )?.destination ||
                      currentCampaign.customer.profile?.phone ||
                      ""
                    }
                  />
                </label>
                <label className="inbox-check">
                  <input
                    type="checkbox"
                    name="confirm"
                    required
                    disabled={!admin}
                  />
                  I verified this campaign contact’s mobile number and
                  permission to receive qualified lead details by text.
                </label>
                <button disabled={!admin || busy}>
                  Save campaign main contact
                </button>
              </form>
              <h3>Employee reply alerts</h3>
              <p>
                Notify multiple employees by email, text, or both. Alerts
                contain a secure inbox link, not the contact’s message.{" "}
                {data.notificationsEnabled
                  ? "Notifications are enabled; each channel still needs verified setup."
                  : "External alerts are off until the delivery provider is configured."}
              </p>
              {data.targets
                .filter(
                  (t) => t.campaignId === campaign && t.kind === "EMPLOYEE",
                )
                .map((t) => (
                  <div className="inbox-draft" key={t.id}>
                    {data.employees.find((e) => e.id === t.employeeId)?.name} ·{" "}
                    {t.channel} · {t.destination} ·{" "}
                    {t.enabled ? "Enabled" : "Disabled"}
                    {admin && (
                      <button
                        disabled={busy}
                        onClick={() =>
                          change("TARGET", {
                            campaignId: campaign,
                            employeeId: t.employeeId,
                            channel: t.channel,
                            destination: t.destination,
                            enabled: !t.enabled,
                            confirmPermission: true,
                          })
                        }
                      >
                        {t.enabled ? "Disable" : "Enable"}
                      </button>
                    )}
                  </div>
                ))}
              {admin && (
                <form
                  onSubmit={(e) => {
                    const f = form(e);
                    void change("TARGET", {
                      campaignId: campaign,
                      employeeId: f.employeeId,
                      channel: f.channel,
                      destination: f.destination,
                      enabled: true,
                      confirmPermission: f.confirm === "on",
                    });
                  }}
                >
                  <label>
                    Employee
                    <select name="employeeId" required>
                      <option value="">Select employee</option>
                      {data.employees.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.name} — {e.email}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Alert type
                    <select name="channel">
                      <option value="EMAIL">Email</option>
                      <option value="SMS">Text message</option>
                    </select>
                  </label>
                  <label>
                    Email or mobile number
                    <input
                      name="destination"
                      required
                      placeholder="Employee account email or +1 phone number"
                    />
                  </label>
                  <label className="inbox-check">
                    <input name="confirm" type="checkbox" required />
                    This employee owns this destination and agreed to receive
                    reply alerts.
                  </label>
                  <button disabled={busy}>Save alert recipient</button>
                </form>
              )}
              <p className="microcopy">
                Alert delivery:{" "}
                {data.notifications
                  .map((n) => `${n.status}: ${n._count}`)
                  .join(" · ") || "No alerts queued"}
              </p>
              <h3>Approved answers for the AI assistant</h3>
              <p>
                Save accurate, reusable business answers. OpenAI uses these
                examples when drafting; this does not train a custom model.
                Remove personal details before saving. Autonomous replies are
                not enabled.
              </p>
              {data.knowledge
                .filter((k) => k.campaignId === campaign)
                .map((k) => (
                  <article className="inbox-draft" key={k.id}>
                    <strong>{k.question}</strong>
                    <p>{k.answer}</p>
                    {admin && (
                      <button
                        disabled={busy}
                        onClick={() => change("RETIRE_KNOWLEDGE", { id: k.id })}
                      >
                        Retire answer
                      </button>
                    )}
                  </article>
                ))}
              {admin && (
                <form
                  onSubmit={(e) => {
                    const f = form(e);
                    void change("KNOWLEDGE", {
                      campaignId: campaign,
                      question: f.question,
                      answer: f.answer,
                    });
                  }}
                >
                  <label>
                    Common question
                    <input name="question" required maxLength={500} />
                  </label>
                  <label>
                    Approved answer
                    <textarea
                      name="answer"
                      required
                      maxLength={3000}
                      rows={4}
                    />
                  </label>
                  <button disabled={busy}>Approve and save answer</button>
                </form>
              )}
            </>
          )}
          {!admin && (
            <p>
              An administrator manages sender numbers, alert recipients and
              approved answers.
            </p>
          )}
        </section>
      )}
      {!!data.unmatched.length && (
        <details className="inbox-unmatched">
          <summary>
            Unmatched incoming messages ({data.unmatched.length})
          </summary>
          <p>
            These messages could not be safely linked to one campaign. An
            administrator should review the sender and campaign history before
            responding. No automated reply is sent.
          </p>
          {data.unmatched.map((m) => (
            <article key={m.key}>
              <strong>
                {m.sender} → {m.destination}
              </strong>
              <p>{m.reason}</p>
              <p>{m.body}</p>
            </article>
          ))}
        </details>
      )}
    </>
  );
}
