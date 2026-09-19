import test from "node:test";
import assert from "node:assert/strict";
import { db } from "../src/lib/db";
import { POST } from "../src/app/api/campaigns/[campaignId]/activate/route";

test("lead collection requires an active administrator, same origin, and explicit confirmation before touching campaign data", async (t) => {
  let admin = false;
  let active = true;
  let campaignCalls = 0;
  const original = db.employeeSession.findUnique;
  t.after(() => {
    db.employeeSession.findUnique = original;
  });
  db.employeeSession.findUnique = (async () => ({
    expiresAt: new Date(Date.now() + 60000),
    employee: {
      id: "synthetic-admin",
      isAdmin: admin,
      isActive: active,
      mustChangePassword: false,
    },
  })) as unknown as typeof original;
  const originalTransaction = db.$transaction;
  t.after(() => {
    db.$transaction = originalTransaction;
  });
  db.$transaction = (async () => {
    campaignCalls++;
    throw new Error("Campaign database must not be reached");
  }) as typeof originalTransaction;
  const invoke = (headers: Record<string, string> = {}) =>
    POST(
      new Request("https://example.invalid/api/campaigns/invalid/activate", {
        method: "POST",
        headers,
      }),
      { params: Promise.resolve({ campaignId: "invalid" }) },
    );
  const signed = {
    cookie: `ap_employee=${"a".repeat(64)}`,
    origin: "https://example.invalid",
    "x-confirm-lead-collection": "yes",
  };
  assert.equal((await invoke()).status, 401);
  assert.equal((await invoke(signed)).status, 403);
  admin = true;
  assert.equal(
    (await invoke({ ...signed, origin: "https://other.invalid" })).status,
    403,
  );
  assert.equal(
    (await invoke({ ...signed, "x-confirm-lead-collection": "" })).status,
    400,
  );
  const validAccess = await invoke(signed);
  assert.equal((await validAccess.json()).error, "Invalid campaign ID.");
  active = false;
  assert.equal((await invoke(signed)).status, 401);
  assert.equal(campaignCalls, 0);
});
