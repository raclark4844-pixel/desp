import test from "node:test";
import assert from "node:assert/strict";
import { weeklyCutoff, UNIT_CENTS, usd } from "../src/lib/billing/schedule";
import { GET } from "../src/app/api/internal/billing/worker/route";
import { POST } from "../src/app/api/billing/route";
test("weekly billing uses end of Friday Eastern, including DST and boundary", () => {
  assert.equal(
    weeklyCutoff(new Date("2026-09-19T03:59:59Z")).toISOString(),
    "2026-09-12T04:00:00.000Z",
  );
  assert.equal(
    weeklyCutoff(new Date("2026-09-19T04:00:00Z")).toISOString(),
    "2026-09-19T04:00:00.000Z",
  );
  assert.equal(
    weeklyCutoff(new Date("2026-01-10T05:00:00Z")).toISOString(),
    "2026-01-10T05:00:00.000Z",
  );
  assert.equal(
    weeklyCutoff(new Date("2026-03-09T12:00:00Z")).toISOString(),
    "2026-03-07T05:00:00.000Z",
  );
  assert.equal(
    weeklyCutoff(new Date("2026-11-02T12:00:00Z")).toISOString(),
    "2026-10-31T04:00:00.000Z",
  );
  assert.equal(usd(3 * UNIT_CENTS), "$180.00");
});
test("billing endpoints deny public access", async () => {
  assert.equal(
    (await GET(new Request("https://example.com/api/internal/billing/worker")))
      .status,
    401,
  );
  assert.equal(
    (
      await POST(
        new Request("https://example.com/api/billing", { method: "POST" }),
      )
    ).status,
    401,
  );
});
