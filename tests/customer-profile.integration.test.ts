import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../src/lib/db";
import { newSession } from "../src/lib/employee/auth";
import { editableProfile } from "../src/lib/customer-profile";
import { PATCH } from "../src/app/api/customers/[customerId]/route";
test("customer profile edits require sign-in and reject stale updates while retaining provenance", { skip: process.env.APS_ISOLATED_TEST_DB !== "true" }, async () => {
  const suffix = randomUUID(); let employeeId: string | undefined, customerId: string | undefined;
  try {
    const employee = await db.employee.create({ data: { username: suffix, email: `${suffix}@example.invalid`, name: "Profile test", passwordHash: "not-login-enabled", mustChangePassword: false } }); employeeId = employee.id;
    const session = newSession(); await db.employeeSession.create({ data: { employeeId, tokenHash: session.tokenHash, expiresAt: session.expiresAt } });
    const customer = await db.customer.create({ data: { name: "Profile test", slug: suffix, profile: { sourceUrl: "https://example.invalid", notes: "Check contact" } } }); customerId = customer.id;
    const body = { updatedAt: customer.updatedAt.toISOString(), name: "Updated profile", websiteUrl: "https://example.invalid", contactName: "Test contact", contactEmail: "profile@example.invalid", timezone: "America/New_York", profile: { ...editableProfile(customer.profile), phone: "440-555-0100" } };
    const context = { params: Promise.resolve({ customerId }) };
    const request = (cookie = "", origin = "https://example.invalid") => new Request(`https://example.invalid/api/customers/${customerId}`, { method: "PATCH", headers: { origin, cookie, "content-type": "application/json" }, body: JSON.stringify(body) });
    assert.equal((await PATCH(request(), context)).status, 401);
    assert.equal((await PATCH(request(`ap_employee=${session.token}`, "https://wrong.invalid"), context)).status, 403);
    assert.equal((await PATCH(request(`ap_employee=${session.token}`), context)).status, 200);
    assert.equal((await PATCH(request(`ap_employee=${session.token}`), context)).status, 409);
    const saved = await db.customer.findUniqueOrThrow({ where: { id: customerId } });
    assert.equal(saved.name, body.name); assert.equal((saved.profile as { sourceUrl: string }).sourceUrl, "https://example.invalid");
    assert.equal(await db.auditEvent.count({ where: { customerId, eventType: "customer.profile_updated" } }), 1);
  } finally {
    if (customerId) { await db.auditEvent.deleteMany({ where: { customerId } }); await db.customer.delete({ where: { id: customerId } }); }
    if (employeeId) await db.employee.delete({ where: { id: employeeId } });
    await db.$disconnect();
  }
});
