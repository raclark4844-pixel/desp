import test from "node:test";
import assert from "node:assert/strict";
import {
  hashPassword,
  checkPassword,
  passwordValid,
} from "../src/lib/employee/password";
import { employeeFromRequest } from "../src/lib/employee/auth";
import { POST } from "../src/app/api/employee/users/route";
test("employee passwords are salted and wrong passwords and malformed sessions fail closed", async () => {
  const password = "Synthetic-passphrase-only";
  const hash = await hashPassword(password);
  assert.notEqual(hash, await hashPassword(password));
  assert.ok(await checkPassword(password, hash));
  assert.equal(await checkPassword("incorrect", hash), false);
  assert.equal(await checkPassword(password, "corrupt"), false);
  assert.equal(passwordValid("short"), false);
  assert.equal(passwordValid("a".repeat(129)), false);
  assert.equal(
    await employeeFromRequest(
      new Request("https://example.invalid", {
        headers: { cookie: "ap_employee=forged" },
      }),
    ),
    null,
  );
  assert.equal(
    (
      await POST(
        new Request("https://example.invalid/api/employee/users", {
          method: "POST",
        }),
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await POST(
        new Request("https://example.invalid/api/employee/users", {
          method: "POST",
          headers: { origin: "https://example.invalid" },
        }),
      )
    ).status,
    403,
  );
});
