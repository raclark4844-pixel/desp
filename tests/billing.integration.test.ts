import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../src/lib/db";
import {
  generateInvoice,
  dispatchInvoice,
  billingAction,
  invoiceText,
  billingWorker,
  RYAN,
} from "../src/lib/billing/service";
import { campaignCosts } from "../src/lib/billing/costs";
import { POST } from "../src/app/api/billing/route";
import { newSession } from "../src/lib/employee/auth";
test(
  "isolated billing: sent-only, customer isolation, $60 arithmetic, dedup, costs and no blind email retries",
  { skip: process.env.APS_ISOLATED_TEST_DB !== "true" },
  async () => {
    const env = { ...process.env },
      oldFetch = global.fetch;
    const customers: string[] = [],
      employeeId = randomUUID();
    const previousConfig = await db.billingConfig.findUnique({
      where: { id: "main" },
    });
    try {
      global.fetch = async () => {
        throw Error("Unexpected network call");
      };
      const customer = await db.customer.create({
        data: {
          name: "Billing Synthetic",
          slug: randomUUID(),
          contactEmail: "customer@example.com",
        },
      });
      customers.push(customer.id);
      const other = await db.customer.create({
        data: {
          name: "Other Billing Synthetic",
          slug: randomUUID(),
          contactEmail: "other@example.com",
        },
      });
      customers.push(other.id);
      await db.employee.create({
        data: {
          id: employeeId,
          name: "Billing Test",
          username: randomUUID(),
          email: `${randomUUID()}@example.com`,
          passwordHash: "unused",
          mustChangePassword: false,
        },
      });
      const session = newSession();
      await db.employeeSession.create({
        data: {
          employeeId,
          tokenHash: session.tokenHash,
          expiresAt: session.expiresAt,
        },
      });
      const headers = {
        origin: "https://example.com",
        cookie: `ap_employee=${session.token}`,
        "Content-Type": "application/json",
      };
      assert.equal(
        (
          await POST(
            new Request("https://example.com/api/billing", {
              method: "POST",
              headers,
              body: "{}",
            }),
          )
        ).status,
        403,
      );
      const campaign = await db.campaign.create({
        data: {
          customerId: customer.id,
          name: "Roofing Test",
          industry: "roofing",
        },
      });
      const target = await db.notificationTarget.create({
        data: {
          campaignId: campaign.id,
          kind: "CUSTOMER",
          name: "Main",
          channel: "SMS",
          destination: "+12025550119",
          confirmedAt: new Date(),
        },
      });
      const sent = new Date("2026-09-18T12:00:00Z"),
        cutoff = new Date("2026-09-19T04:00:00Z");
      for (const status of ["SENT", "SENT", "PENDING", "FAILED", "UNKNOWN"]) {
        const lead = await db.lead.create({
          data: { customerId: customer.id },
        });
        const contact = await db.contact.create({
          data: {
            leadId: lead.id,
            type: "MOBILE",
            value: "+12025550111",
            normalizedValue: "+12025550111",
          },
        });
        const c = await db.conversation.create({
          data: {
            campaignId: campaign.id,
            leadId: lead.id,
            contactId: contact.id,
            channel: "SMS",
          },
        });
        await db.replyNotification.create({
          data: {
            targetId: target.id,
            receiptKey: randomUUID(),
            conversationId: c.id,
            kind: "LEAD_HANDOFF",
            status,
            body: `Name: Synthetic ${status}\nService requested: Roofing`,
            updatedAt: sent,
          },
        });
      }
      await billingAction(
        {
          action: "SETTINGS",
          customerId: customer.id,
          email: "invoice@example.com",
          thirdEmail: "copy@example.com",
          enabled: true,
        },
        employeeId,
      );
      const [i, duplicate] = await Promise.all([
        generateInvoice(customer.id, cutoff),
        generateInvoice(customer.id, cutoff),
      ]);
      assert.ok(i);
      assert.equal(i!.id, duplicate!.id);
      assert.equal(i!.totalCents, 12000);
      assert.deepEqual(i!.recipients, [
        "invoice@example.com",
        RYAN,
        "copy@example.com",
      ]);
      const invoice = await db.billingInvoice.findUniqueOrThrow({
        where: { id: i!.id },
        include: { lines: true },
      });
      assert.equal(invoice.lines.length, 2);
      assert.match(invoiceText(invoice), /2 × \$60.00 = \$120.00/);
      assert.equal(await generateInvoice(other.id, cutoff), null);
      assert.equal(
        await generateInvoice(customer.id, new Date("2026-09-26T04:00:00Z")),
        null,
      );
      const worker = await billingWorker(new Date("2026-09-19T04:05:00Z"));
      assert.equal(worker.created, 0);
      assert.equal(worker.delivery, "EMAIL_SETUP_REQUIRED");
      const id = randomUUID();
      const cost = {
        action: "COST",
        id,
        campaignId: campaign.id,
        type: "DATA",
        provider: "Synthetic",
        description: "Property data",
        amount: "12.50",
        date: "2026-09-18",
      };
      await billingAction(cost, employeeId);
      await billingAction(cost, employeeId);
      assert.equal(
        await db.cost.count({ where: { campaignId: campaign.id } }),
        1,
      );
      await billingAction(
        { action: "RATES", campaignId: campaign.id, rates: { SMS: 0.02 } },
        employeeId,
      );
      const costs = await campaignCosts(campaign.id);
      assert.equal(costs.actual, 12.5);
      assert.equal(
        costs.estimates.find((e) => e.metric === "SMS")!.amount,
        0.06,
      );
      assert.equal(
        costs.estimates.find((e) => e.metric === "AI")!.amount,
        null,
      );
      Object.assign(process.env, {
        VERCEL_ENV: "production",
        RESEND_API_KEY: "synthetic",
        BILLING_FROM: "billing@example.com",
        BILLING_EMAIL_VERIFIED: "true",
      });
      let calls = 0;
      global.fetch = async (_url, init) => {
        calls++;
        const body = JSON.parse(String(init?.body));
        assert.deepEqual(body.to, invoice.recipients);
        assert.match(body.text, /Synthetic SENT/);
        assert.doesNotMatch(body.text, /Synthetic PENDING/);
        assert.equal(
          (init?.headers as Record<string, string>)["Idempotency-Key"],
          `invoice-${invoice.id}`,
        );
        return Response.json({ id: `synthetic-${invoice.id}` });
      };
      assert.equal(await dispatchInvoice(), "SENT");
      assert.equal(await dispatchInvoice(), "NO_INVOICE_READY");
      assert.equal(calls, 1);
      // Ambiguous result is retained for review and must never be resent automatically.
      const unknown = await db.billingInvoice.create({
        data: {
          customerId: other.id,
          customerName: other.name,
          number: randomUUID(),
          cutoff,
          totalCents: 6000,
          recipients: ["other@example.com"],
        },
      });
      global.fetch = async () => {
        calls++;
        throw Error("Network outcome unknown");
      };
      assert.equal(await dispatchInvoice(), "UNKNOWN");
      assert.equal(await dispatchInvoice(), "NO_INVOICE_READY");
      assert.equal(calls, 2);
      assert.equal(
        (
          await db.billingInvoice.findUniqueOrThrow({
            where: { id: unknown.id },
          })
        ).status,
        "UNKNOWN",
      );
    } finally {
      global.fetch = oldFetch;
      process.env = env;
      await db.billingInvoice.deleteMany({
        where: { customerId: { in: customers } },
      });
      await db.cost.deleteMany({ where: { customerId: { in: customers } } });
      await db.customer.deleteMany({ where: { id: { in: customers } } });
      await db.auditEvent.deleteMany({ where: { actorId: employeeId } });
      await db.employee.deleteMany({ where: { id: employeeId } });
      if (previousConfig)
        await db.billingConfig.update({
          where: { id: "main" },
          data: { thirdEmail: previousConfig.thirdEmail },
        });
      else await db.billingConfig.deleteMany({ where: { id: "main" } });
      await db.$disconnect();
    }
  },
);
