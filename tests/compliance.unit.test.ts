import test from "node:test";
import assert from "node:assert/strict";
import { evaluatePolicy, type PolicyInput } from "../src/lib/compliance/policy";
const now = new Date("2026-09-18T12:00:00Z");
const good = (): PolicyInput => ({
  channel: "SMS",
  contactType: "MOBILE",
  normalizedValue: "+12025550101",
  isValid: null,
  active: true,
  enrolled: true,
  leadStatus: "NEW",
  channelRequested: true,
  campaignStart: null,
  campaignEnd: null,
  suppressed: false,
  evidenceOverflow: false,
  consents: [
    {
      status: "GRANTED",
      observedAt: "2026-09-18T10:00:00Z",
      expiresAt: "2026-09-19T10:00:00Z",
      supported: true,
    },
  ],
  checks: [
    "CONTACT_OWNERSHIP",
    "JURISDICTION_REVIEW",
    "DNC",
    "REASSIGNED_NUMBER",
  ].map((check) => ({
    check: check as "DNC",
    outcome: "PASS",
    observedAt: "2026-09-18T10:00:00Z",
    expiresAt: "2026-09-19T10:00:00Z",
  })),
});
test("complete evidence permits review only, never outreach", () => {
  const r = evaluatePolicy(good(), now);
  assert.equal(r.reviewStatus, "READY_FOR_REVIEW");
  assert.equal(r.outreachAllowed, false);
});
test("every blocking condition fails closed", () => {
  for (const patch of [
    { active: false },
    { enrolled: false },
    { channelRequested: false },
    { suppressed: true },
    { isValid: false },
    { leadStatus: "SUPPRESSED" },
    { contactType: "LANDLINE" },
    { consents: [] },
    { checks: [] },
    { evidenceOverflow: true },
    { campaignStart: new Date("2027-01-01") },
    { campaignEnd: new Date("2025-01-01") },
  ])
    assert.equal(
      evaluatePolicy({ ...good(), ...patch }, now).reviewStatus,
      "BLOCKED",
    );
});
test("newer and tied failures override passes; stale checks rejected", () => {
  for (const observedAt of ["2026-09-18T10:00:00Z", "2026-09-18T11:00:00Z"]) {
    const p = good();
    p.checks.push({ ...p.checks[0], outcome: "FAIL", observedAt });
    assert.equal(evaluatePolicy(p, now).reviewStatus, "BLOCKED");
  }
  const p = good();
  p.checks[0].expiresAt = now.toISOString();
  assert.equal(evaluatePolicy(p, now).reviewStatus, "BLOCKED");
});
test("revocation, unsupported consent, future evidence and email mismatch block", () => {
  for (const patch of [
    { status: "REVOKED" },
    { supported: false },
    { observedAt: "2027-01-01T00:00:00Z" },
    { expiresAt: null },
  ]) {
    const p = good();
    p.consents = [{ ...p.consents[0], ...patch }];
    assert.equal(evaluatePolicy(p, now).reviewStatus, "BLOCKED");
  }
  assert.equal(
    evaluatePolicy({ ...good(), channel: "EMAIL" }, now).reviewStatus,
    "BLOCKED",
  );
});
test("compliance endpoints reject unauthenticated requests before database work", async () => {
  const { POST: evidence } =
    await import("../src/app/api/internal/compliance/evidence/route");
  const { POST: evaluate } =
    await import("../src/app/api/internal/compliance/evaluate/route");
  for (const route of [evidence, evaluate])
    assert.equal(
      (
        await route(
          new Request("http://localhost", { method: "POST", body: "{}" }),
        )
      ).status,
      401,
    );
});
