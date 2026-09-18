"use client";

import { useEffect, useId, useRef, useState } from "react";

type Customer = {
  id: string;
  name: string;
  slug: string;
  status: string;
  websiteUrl: string | null;
  contactName: string | null;
  contactEmail: string | null;
  timezone: string;
};
const blank = {
  name: "",
  websiteUrl: "",
  contactName: "",
  contactEmail: "",
  timezone: "America/New_York",
};

export function CustomerFields() {
  const [details, setDetails] = useState(blank);
  const [selected, setSelected] = useState<Customer | null>(null);
  const [matches, setMatches] = useState<Customer[]>([]);
  const [active, setActive] = useState(0);
  const [focused, setFocused] = useState(false);
  const [notice, setNotice] = useState("");
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  useEffect(() => {
    const query = details.name.trim();
    if (selected || !focused || query.length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setNotice("Searching saved customers…");
      try {
        const response = await fetch(
          `/api/internal/customers?q=${encodeURIComponent(query)}`,
          {
            signal: controller.signal,
            cache: "no-store",
          },
        );
        const body = await response.json();
        if (controller.signal.aborted) return;
        setNeedsSignIn(response.status === 401);
        if (!response.ok) {
          setMatches([]);
          setNotice(body.error ?? "Customer search is unavailable.");
          return;
        }
        setMatches(body.customers);
        setActive(0);
        setNotice(
          body.customers.length
            ? "Use arrow keys to choose a customer. Press Tab or Enter to fill their details."
            : "No saved match. Continue to create a new customer.",
        );
      } catch {
        if (!controller.signal.aborted)
          setNotice(
            "Customer search is unavailable. Try again before creating a duplicate.",
          );
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [details.name, focused, selected]);

  function choose(customer: Customer) {
    if (
      customer.status !== "ACTIVE" ||
      !customer.contactName ||
      !customer.contactEmail
    ) {
      setNotice(
        "This saved customer is inactive or missing contact details. The saved profile must be completed before it can be used.",
      );
      return;
    }
    setSelected(customer);
    setDetails({
      name: customer.name,
      websiteUrl: customer.websiteUrl ?? "",
      contactName: customer.contactName,
      contactEmail: customer.contactEmail,
      timezone: customer.timezone,
    });
    setMatches([]);
    setNotice(
      "Saved customer selected. Their details and customer ID will be reused.",
    );
  }
  const open = focused && !selected && matches.length > 0;
  return (
    <>
      <p>
        Search saved customers by company name after{" "}
        <a href="/operations" target="_blank" rel="noopener noreferrer">
          signing in to Operations
        </a>
        . Select a match to fill the details, or enter a new customer.
      </p>
      <input type="hidden" name="customerId" value={selected?.id ?? ""} />
      <div className="field-grid two-column">
        <div className="customer-search">
          <label htmlFor={`${listId}-input`}>Company name</label>
          <input
            id={`${listId}-input`}
            ref={inputRef}
            name="companyName"
            required
            minLength={2}
            maxLength={160}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            aria-activedescendant={open ? `${listId}-${active}` : undefined}
            aria-describedby={`${listId}-notice`}
            autoComplete="off"
            value={details.name}
            onFocus={() => setFocused(true)}
            onBlur={() => {
              setFocused(false);
              setMatches([]);
            }}
            onChange={(event) => {
              setDetails(
                selected
                  ? { ...blank, name: event.target.value }
                  : { ...details, name: event.target.value },
              );
              setSelected(null);
              setMatches([]);
              setNotice("");
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (!open || event.nativeEvent.isComposing) return;
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                setActive(
                  (current) =>
                    (current +
                      (event.key === "ArrowDown" ? 1 : -1) +
                      matches.length) %
                    matches.length,
                );
              } else if (event.key === "Escape") {
                setMatches([]);
              } else if (
                event.key === "Enter" ||
                (event.key === "Tab" && !event.shiftKey)
              ) {
                if (event.key === "Enter") event.preventDefault();
                choose(matches[active]);
              }
            }}
          />
          {open && (
            <ul
              id={listId}
              role="listbox"
              aria-label="Matching customers"
              className="customer-matches"
            >
              {matches.map((customer, index) => (
                <li
                  key={customer.id}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={index === active}
                  aria-disabled={
                    customer.status !== "ACTIVE" ||
                    !customer.contactName ||
                    !customer.contactEmail
                  }
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(customer)}
                >
                  <strong>{customer.name}</strong>
                  <span>
                    {customer.contactEmail ?? "Contact details missing"} ·{" "}
                    {customer.status}
                  </span>
                  <small>{customer.slug}</small>
                </li>
              ))}
            </ul>
          )}
        </div>
        <label>
          Company website
          <input
            name="websiteUrl"
            type="url"
            placeholder="https://example.com"
            autoComplete="url"
            value={details.websiteUrl}
            readOnly={!!selected}
            onChange={(event) =>
              setDetails({ ...details, websiteUrl: event.target.value })
            }
          />
        </label>
        <label>
          Primary contact
          <input
            name="contactName"
            required
            minLength={2}
            autoComplete="name"
            value={details.contactName}
            readOnly={!!selected}
            onChange={(event) =>
              setDetails({ ...details, contactName: event.target.value })
            }
          />
        </label>
        <label>
          Contact email
          <input
            name="contactEmail"
            type="email"
            required
            autoComplete="email"
            value={details.contactEmail}
            readOnly={!!selected}
            onChange={(event) =>
              setDetails({ ...details, contactEmail: event.target.value })
            }
          />
        </label>
        <label>
          Time zone
          {selected ? (
            <input name="timezone" readOnly value={details.timezone} />
          ) : (
            <select
              name="timezone"
              value={details.timezone}
              onChange={(event) =>
                setDetails({ ...details, timezone: event.target.value })
              }
            >
              <option value="America/New_York">Eastern</option>
              <option value="America/Chicago">Central</option>
              <option value="America/Denver">Mountain</option>
              <option value="America/Los_Angeles">Pacific</option>
            </select>
          )}
        </label>
        <label className="honeypot" aria-hidden="true">
          Company fax
          <input name="companyFax" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <p id={`${listId}-notice`} role="status">
        {notice}{" "}
        {needsSignIn && (
          <a href="/operations" target="_blank" rel="noopener noreferrer">
            Open Operations sign-in
          </a>
        )}
      </p>
      {selected && (
        <div className="notice">
          <p>
            <strong>Using saved customer:</strong> {selected.name}. Saved
            details are protected from changes in this form.
          </p>
          <button
            type="button"
            onClick={() => {
              setSelected(null);
              setDetails(blank);
              setNotice("");
              setNeedsSignIn(false);
              inputRef.current?.focus();
            }}
          >
            Use a new customer
          </button>
          <label>
            Operator key to save this customer’s campaign
            <input
              type="password"
              name="customerAuthorization"
              required
              autoComplete="off"
            />
          </label>
          <small>
            The Operations session allows lookup. Your operator key authorizes
            saving a draft linked to this customer.
          </small>
        </div>
      )}
    </>
  );
}
