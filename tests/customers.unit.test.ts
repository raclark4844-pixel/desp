import test from "node:test";
import assert from "node:assert/strict";
import { GET } from "../src/app/api/internal/customers/route";
import { createSession } from "../src/lib/operations/session";

test("customer lookup rejects public access and bounds authenticated queries without database work", async () => {
  const previous = process.env.APS_INTERNAL_API_KEY;
  process.env.APS_INTERNAL_API_KEY = "customer-unit-test-only";
  try {
    const denied = await GET(new Request("https://example.invalid/api/internal/customers?q=acme"));
    assert.equal(denied.status, 401);
    assert.match(denied.headers.get("cache-control")!, /no-store/);
    const cookie = `aps_operations=${createSession()}`;
    for (const query of ["", "a", "a".repeat(101)]) {
      const result = await GET(new Request(`https://example.invalid/api/internal/customers?q=${query}`, { headers: { cookie } }));
      assert.equal(result.status, 200);
      assert.deepEqual(await result.json(), { customers: [] });
    }
  } finally {
    if (previous === undefined) delete process.env.APS_INTERNAL_API_KEY;
    else process.env.APS_INTERNAL_API_KEY = previous;
  }
});
