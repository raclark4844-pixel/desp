import test from "node:test";
import assert from "node:assert/strict";
import {
  createSession,
  validSession,
  SESSION_COOKIE,
  SESSION_SECONDS,
} from "../src/lib/operations/session";
import { POST, DELETE } from "../src/app/api/operations/session/route";
import { GET } from "../src/app/api/internal/operations/route";
import { POST as compliance } from "../src/app/api/internal/compliance/evaluate/route";
test("operator session is signed, expires, and cannot authorize operational mutations", async () => {
  const old = process.env.APS_INTERNAL_API_KEY;
  process.env.APS_INTERNAL_API_KEY = "synthetic-unit-key";
  try {
    const now = Date.now();
    const token = createSession(now);
    assert.equal(validSession(token, now), true);
    assert.equal(validSession(token, now + SESSION_SECONDS * 1000), false);
    assert.equal(validSession(token + "x", now), false);
    const cookie = `${SESSION_COOKIE}=${token}`;
    assert.equal(
      (
        await compliance(
          new Request("https://example.invalid/api", {
            method: "POST",
            headers: { cookie },
            body: "{}",
          }),
        )
      ).status,
      401,
    );
    assert.equal(
      (
        await POST(
          new Request("https://example.invalid/api/operations/session", {
            method: "POST",
            headers: {
              origin: "https://evil.invalid",
              "x-aps-internal-key": "synthetic-unit-key",
            },
          }),
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await POST(
          new Request("https://example.invalid/api/operations/session", {
            method: "POST",
            headers: { origin: "https://example.invalid" },
          }),
        )
      ).status,
      401,
    );
    const response = await POST(
      new Request("https://example.invalid/api/operations/session", {
        method: "POST",
        headers: {
          origin: "https://example.invalid",
          "x-aps-internal-key": "synthetic-unit-key",
        },
      }),
    );
    assert.equal(response.status, 200);
    assert.match(response.headers.get("set-cookie")!, /HttpOnly/i);
    assert.match(response.headers.get("set-cookie")!, /SameSite=strict/i);
    assert.ok(
      !response.headers.get("set-cookie")!.includes("synthetic-unit-key"),
    );
    assert.equal(
      (
        await GET(
          new Request("https://example.invalid/api/internal/operations"),
        )
      ).status,
      401,
    );
    assert.equal(
      (
        await DELETE(
          new Request("https://example.invalid/api/operations/session", {
            method: "DELETE",
          }),
        )
      ).status,
      403,
    );
    process.env.APS_INTERNAL_API_KEY = "rotated";
    assert.equal(validSession(token, now), false);
    delete process.env.APS_INTERNAL_API_KEY;
    assert.equal(validSession(token, now), false);
  } finally {
    if (old === undefined) delete process.env.APS_INTERNAL_API_KEY;
    else process.env.APS_INTERNAL_API_KEY = old;
  }
});
