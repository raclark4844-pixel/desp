import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  draftSchema,
  setupReasons,
  sendingWindow,
  reservationKey,
} from "../src/lib/outreach/policy";
import { validTwilio, validResend } from "../src/lib/outreach/webhooks";
import { deliveryAdapter, DeliveryError } from "../src/lib/outreach/provider";
test("outreach is fail-closed; windows honor local time and DST", () => {
  assert.ok(setupReasons("SMS", "x", {}).includes("LIVE_SENDING_DISABLED"));
  assert.ok(
    setupReasons("CALL", "x", {}).includes(
      "FTC_REGISTRATION_MISSING_OR_EXPIRED",
    ),
  );
  assert.equal(
    sendingWindow("America/New_York", new Date("2026-09-18T14:00:00Z")),
    true,
  );
  assert.equal(
    sendingWindow("America/New_York", new Date("2026-09-18T22:00:00Z")),
    false,
  );
  assert.equal(
    sendingWindow("America/New_York", new Date("2026-09-19T15:00:00Z")),
    false,
  );
  assert.equal(
    sendingWindow("America/New_York", new Date("2026-01-16T14:30:00Z")),
    false,
  );
  assert.equal(sendingWindow("not-a-zone"), false);
  assert.notEqual(
    reservationKey("a", "SMS", "phone"),
    reservationKey("a", "CALL", "phone"),
  );
  assert.notEqual(
    reservationKey("a", "SMS", "phone"),
    reservationKey("b", "SMS", "phone"),
  );
  assert.equal(draftSchema.safeParse({}).success, false);
});
test("signed webhooks reject tampering and stale email callbacks", () => {
  const url = "https://app.example/api/outreach/twilio",
    params = new URLSearchParams({
      AccountSid: "ACtest",
      Body: "STOP",
      From: "+12025550101",
    }),
    key = "test-secret";
  const signature = createHmac("sha1", key)
    .update(url + "AccountSidACtestBodySTOPFrom+12025550101")
    .digest("base64");
  assert.equal(validTwilio(url, params, signature, key), true);
  params.set("Body", "START");
  assert.equal(validTwilio(url, params, signature, key), false);
  const now = Date.now(),
    ts = String(Math.floor(now / 1000)),
    secret = Buffer.from("test-webhook-secret").toString("base64"),
    body = '{"type":"email.delivered"}';
  const h = new Headers({
    "svix-id": "event1",
    "svix-timestamp": ts,
    "svix-signature":
      "v1," +
      createHmac("sha256", Buffer.from(secret, "base64"))
        .update(`event1.${ts}.${body}`)
        .digest("base64"),
  });
  assert.equal(validResend(body, h, "whsec_" + secret, now), true);
  assert.equal(validResend(body + " ", h, "whsec_" + secret, now), false);
  assert.equal(validResend(body, h, "whsec_" + secret, now + 400000), false);
});
test("provider adapters use stable email key and never retry ambiguous sends", async () => {
  const original = globalThis.fetch;
  const prior = { ...process.env };
  try {
    Object.assign(process.env, {
      OUTREACH_PUBLIC_URL: "https://app.example",
      OUTREACH_FROM_EMAIL: "sender@example.com",
      OUTREACH_REPLY_TO: "reply@example.com",
      TWILIO_ACCOUNT_SID: "ACtest",
      TWILIO_AUTH_TOKEN: "test",
      TWILIO_MESSAGING_SERVICE_SID: "MGtest",
      TWILIO_VOICE_FROM: "+12025550100",
      OUTREACH_AGENT_PHONE: "+12025550102",
    });
    const base = {
      id: "recipient1",
      destination: "lead@example.com",
      body: "Hello there",
      subject: "Offer",
      senderName: "Sender",
      mailingAddress: "123 Test St",
      unsubscribeToken: "token",
    };
    let calls = 0;
    globalThis.fetch = async (url, options) => {
      calls++;
      assert.equal(url, "https://api.resend.com/emails");
      assert.equal(
        (options!.headers as Record<string, string>)["Idempotency-Key"],
        "outbound-recipient1",
      );
      const body = JSON.parse(options!.body as string);
      assert.equal(
        body.headers["List-Unsubscribe"],
        "<https://app.example/api/outreach/unsubscribe?token=token>",
      );
      assert.ok(body.text.includes("Advertisement"));
      return Response.json({ id: "email1" });
    };
    assert.equal(
      await deliveryAdapter.send({ ...base, channel: "EMAIL" }),
      "email1",
    );
    globalThis.fetch = async (_url, options) => {
      calls++;
      const p = new URLSearchParams(options!.body as URLSearchParams);
      assert.equal(p.get("To"), "+12025550102");
      assert.ok(p.get("Url")?.includes("action=voice"));
      return Response.json({ sid: "CA1" });
    };
    assert.equal(
      await deliveryAdapter.send({ ...base, channel: "CALL" }),
      "CA1",
    );
    globalThis.fetch = async () => {
      calls++;
      throw new Error("timeout");
    };
    await assert.rejects(
      deliveryAdapter.send({ ...base, channel: "SMS" }),
      (e) => e instanceof DeliveryError && e.kind === "UNKNOWN",
    );
    assert.equal(calls, 3);
  } finally {
    globalThis.fetch = original;
    process.env = prior;
  }
});
