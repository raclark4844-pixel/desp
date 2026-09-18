import test from "node:test";
import assert from "node:assert/strict";
import { maskContact } from "../src/lib/operations/review";
import { createSession, SESSION_COOKIE } from "../src/lib/operations/session";
import { POST as save } from "../src/app/api/internal/operations/review/evidence/route";
import { GET, POST } from "../src/app/api/internal/operations/review/route";
test("review masks contacts and denies writes to read-only sessions", async () => {
  assert.equal(maskContact("+12025550101", "MOBILE"), "Phone ending 0101");
  assert.equal(
    maskContact("owner@example.invalid", "EMAIL"),
    "Email address on file",
  );
  const old = process.env.APS_INTERNAL_API_KEY;
  process.env.APS_INTERNAL_API_KEY = "review-unit-key";
  try {
    const url = "https://example.invalid/api/internal/operations/review";
    const cookie = `${SESSION_COOKIE}=${createSession()}`;
    assert.equal((await GET(new Request(url))).status, 401);
    assert.equal(
      (
        await save(
          new Request(url + "/evidence", {
            method: "POST",
            headers: { cookie, origin: "https://example.invalid" },
            body: "{}",
          }),
        )
      ).status,
      401,
    );
    assert.equal(
      (
        await POST(
          new Request(url, {
            method: "POST",
            headers: { cookie, origin: "https://evil.invalid" },
            body: "{}",
          }),
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await save(
          new Request(url + "/evidence", {
            method: "POST",
            headers: {
              "x-aps-internal-key": "review-unit-key",
              origin: "https://example.invalid",
            },
            body: JSON.stringify({ acknowledged: false }),
          }),
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await POST(
          new Request(url, {
            method: "POST",
            headers: { cookie, origin: "https://example.invalid" },
            body: "{}",
          }),
        )
      ).status,
      400,
    );
  } finally {
    if (old === undefined) delete process.env.APS_INTERNAL_API_KEY;
    else process.env.APS_INTERNAL_API_KEY = old;
  }
});
