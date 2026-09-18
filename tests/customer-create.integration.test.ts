import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../src/lib/db";
import { newSession } from "../src/lib/employee/auth";
import { editableProfile } from "../src/lib/customer-profile";
import { POST } from "../src/app/api/customers/route";
import { PATCH } from "../src/app/api/customers/[customerId]/route";
test("non-admin employees can create and edit customers; retries reuse one record", { skip: process.env.APS_ISOLATED_TEST_DB !== "true" }, async () => {
  const suffix = randomUUID(); let employeeId: string | undefined, customerId: string | undefined;
  try {
    const employee = await db.employee.create({ data: { username: suffix, email: `${suffix}@example.invalid`, name: "Customer test", passwordHash: "disabled-test-login", isAdmin: false, mustChangePassword: false } }); employeeId = employee.id;
    const session = newSession(); await db.employeeSession.create({ data: { employeeId, tokenHash: session.tokenHash, expiresAt: session.expiresAt } });
    const body = { requestId: randomUUID(), name: "Synthetic new customer", websiteUrl: "", contactName: "", contactEmail: "", timezone: "America/New_York", profile: editableProfile(null) };
    const request = (cookie = "", data: object = body) => new Request("https://example.invalid/api/customers", { method: "POST", headers: { origin: "https://example.invalid", cookie, "content-type": "application/json" }, body: JSON.stringify(data) });
    assert.equal((await POST(request())).status, 401);
    const cookie = `ap_employee=${session.token}`;
    const created = await POST(request(cookie)); assert.equal(created.status, 201); customerId = (await created.json()).customerId;
    assert.ok(customerId);
    const replay = await POST(request(cookie)); assert.equal(replay.status, 200); assert.equal((await replay.json()).customerId, customerId);
    assert.equal((await POST(request(cookie, { ...body, name: "Different input" }))).status, 409);
    const customer = await db.customer.findUniqueOrThrow({ where: { id: customerId } });
    const { requestId, ...fields } = body;
    const edited = await PATCH(new Request(`https://example.invalid/api/customers/${customerId}`, { method: "PATCH", headers: { origin: "https://example.invalid", cookie, "content-type": "application/json" }, body: JSON.stringify({ ...fields, contactName: "New contact", updatedAt: customer.updatedAt.toISOString() }) }), { params: Promise.resolve({ customerId: customerId! }) });
    assert.equal(edited.status, 200);
    assert.equal((await db.customer.findUniqueOrThrow({ where: { id: customerId } })).contactName, "New contact");
    assert.equal(await db.campaign.count({ where: { customerId } }), 0);
    assert.equal(await db.auditEvent.count({ where: { customerId, actorId: employee.id } }), 2);
  } finally {
    if (customerId) { await db.auditEvent.deleteMany({ where: { customerId } }); await db.customer.delete({ where: { id: customerId } }); }
    if (employeeId) await db.employee.delete({ where: { id: employeeId } });
    await db.$disconnect();
  }
});
