import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../src/lib/db";
import { listReviewContacts } from "../src/lib/operations/review";
import { POST as save } from "../src/app/api/internal/operations/review/evidence/route";
import { POST as evaluate } from "../src/app/api/internal/operations/review/route";
import { createSession, SESSION_COOKIE } from "../src/lib/operations/session";
test(
  "review pagination, membership, evidence saving, replay and opt-out evaluation",
  { skip: process.env.APS_ISOLATED_TEST_DB !== "true" },
  async () => {
    const old = process.env.APS_INTERNAL_API_KEY;
    process.env.APS_INTERNAL_API_KEY = "synthetic-review-key";
    try {
      const customer = await db.customer.create({
        data: { name: "Step8 synthetic", slug: `step8-${randomUUID()}` },
      });
      const campaign = await db.campaign.create({
        data: {
          customerId: customer.id,
          name: "Review verification",
          industry: "roofing",
          status: "READY",
          outreachConfig: { requestedChannels: { sms: true } },
        },
      });
      const lead = await db.lead.create({
        data: {
          customerId: customer.id,
          campaignLeads: { create: { campaignId: campaign.id } },
          contacts: {
            create: Array.from({ length: 51 }, (_, i) => ({
              type: "MOBILE" as const,
              value: `+1202555${String(1000 + i).padStart(4, "0")}`,
              normalizedValue: `+1202555${String(1000 + i).padStart(4, "0")}`,
            })),
          },
        },
      });
      const first = await listReviewContacts({ campaignId: campaign.id });
      assert.equal(first.contacts.length, 50);
      assert.ok(first.nextCursor);
      const second = await listReviewContacts({
        campaignId: campaign.id,
        after: first.nextCursor,
      });
      assert.equal(second.contacts.length, 1);
      assert.equal(second.nextCursor, null);
      assert.ok(!first.contacts.some((c) => c.id === second.contacts[0].id));
      assert.ok(!JSON.stringify(first).includes("+1202555"));
      const target = {
        campaignId: campaign.id,
        leadId: lead.id,
        contactId: first.contacts[0].id,
        channel: "SMS",
      };
      const url = "https://example.invalid/api/internal/operations/review";
      const cookie = `${SESSION_COOKIE}=${createSession()}`;
      const evidence = {
        ...target,
        requestId: randomUUID(),
        action: "CONSENT",
        status: "REVOKED",
        actorRef: "synthetic-operator",
        evidenceRef: "synthetic-case",
        observedAt: new Date(Date.now() - 1000).toISOString(),
      };
      const send = () =>
        save(
          new Request(url + "/evidence", {
            method: "POST",
            headers: {
              origin: "https://example.invalid",
              "x-aps-internal-key": "synthetic-review-key",
            },
            body: JSON.stringify({ acknowledged: true, evidence }),
          }),
        );
      const a = await (await send()).json();
      const b = await (await send()).json();
      assert.equal(a.ok, true);
      assert.equal(a.result.evidenceId, b.result.evidenceId);
      assert.equal(b.result.replayed, true);
      const review = await (
        await evaluate(
          new Request(url, {
            method: "POST",
            headers: { cookie, origin: "https://example.invalid" },
            body: JSON.stringify(target),
          }),
        )
      ).json();
      assert.equal(review.ok, true);
      assert.ok(review.result.reasons.includes("SUPPRESSION_ACTIVE"));
      assert.equal(review.result.outreachAllowed, false);
      await db.campaignLead.update({
        where: {
          campaignId_leadId: { campaignId: campaign.id, leadId: lead.id },
        },
        data: { removedAt: new Date() },
      });
      assert.equal(
        (await listReviewContacts({ campaignId: campaign.id })).contacts.length,
        0,
      );
      assert.equal(
        await db.message.count({ where: { contactId: target.contactId } }),
        0,
      );
    } finally {
      if (old === undefined) delete process.env.APS_INTERNAL_API_KEY;
      else process.env.APS_INTERNAL_API_KEY = old;
      await db.$disconnect();
    }
  },
);
