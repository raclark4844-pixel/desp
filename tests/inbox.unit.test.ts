import test from "node:test";
import assert from "node:assert/strict";
import { isStop } from "../src/lib/inbox/receive";
import { redact } from "../src/lib/inbox/ai";
test("opt-out language and contact redaction", () => {
  for (const text of [
    "STOP",
    "Stopall",
    "Please remove me",
    "Don't contact me",
    "opt-out",
  ])
    assert.equal(isStop(text), true);
  assert.equal(isStop("What time is an estimate available?"), false);
  assert.equal(
    redact("Call +1 (202) 555-0101 or test@example.com"),
    "Call [phone] or [email]",
  );
});
