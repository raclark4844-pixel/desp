import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../src/lib/db";
import {
  recordEvidence,
  evaluateReadiness,
} from "../src/lib/compliance/service";
test(
  "isolated compliance lineage, idempotency, consent, suppression and invalidation",
  { skip: process.env.APS_ISOLATED_TEST_DB !== "true" },
  async () => {
    try {
      const customer = await db.customer.create({
        data: { name: "Synthetic Step6", slug: `step6-${randomUUID()}` },
      });
      const campaign = await db.campaign.create({
        data: {
          customerId: customer.id,
          name: "Synthetic",
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
            create: {
              type: "MOBILE",
              value: "+12025550101",
              normalizedValue: "+12025550101",
            },
          },
        },
        include: { contacts: true },
      });
      const target = {
        campaignId: campaign.id,
        leadId: lead.id,
        contactId: lead.contacts[0].id,
        channel: "SMS",
      };
      const base = {
        ...target,
        actorRef: "synthetic-operator",
        evidenceRef: "synthetic-reference",
        observedAt: new Date(Date.now() - 1000).toISOString(),
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      };
      assert.equal((await evaluateReadiness(target)).reviewStatus, "BLOCKED");
      const consent = {
        ...base,
        requestId: randomUUID(),
        action: "CONSENT",
        status: "GRANTED",
      };
      const pair = await Promise.all([
        recordEvidence(consent),
        recordEvidence(consent),
      ]);
      assert.equal(pair[0].evidenceId, pair[1].evidenceId);
      await assert.rejects(
        recordEvidence({ ...consent, status: "REVOKED" }),
        /IDEMPOTENCY_CONFLICT/,
      );
      for (const check of [
        "CONTACT_OWNERSHIP",
        "JURISDICTION_REVIEW",
        "DNC",
        "REASSIGNED_NUMBER",
      ])
        await recordEvidence({
          ...base,
          requestId: randomUUID(),
          action: "CHECK",
          check,
          outcome: "PASS",
        });
      assert.equal(
        (await evaluateReadiness(target)).reviewStatus,
        "READY_FOR_REVIEW",
      );
      assert.equal((await evaluateReadiness(target)).outreachAllowed, false);
      await db.campaign.update({
        where: { id: campaign.id },
        data: { targetingConfig: { changed: true } },
      });
      assert.equal((await evaluateReadiness(target)).reviewStatus, "BLOCKED");
      const other = await db.customer.create({
        data: { name: "Other", slug: `step6-${randomUUID()}` },
      });
      const foreign = await db.campaign.create({
        data: { customerId: other.id, name: "Other", industry: "roofing" },
      });
      await assert.rejects(
        evaluateReadiness({ ...target, campaignId: foreign.id }),
        /TARGET_NOT_FOUND/,
      );
      await recordEvidence({
        ...base,
        requestId: randomUUID(),
        action: "CONSENT",
        status: "REVOKED",
      });
      assert.ok(
        (await evaluateReadiness(target)).reasons.includes(
          "SUPPRESSION_ACTIVE",
        ),
      );
      const duplicate = await db.lead.create({
        data: {
          customerId: customer.id,
          campaignLeads: { create: { campaignId: campaign.id } },
          contacts: {
            create: {
              type: "MOBILE",
              value: "+12025550101",
              normalizedValue: "+12025550101",
            },
          },
        },
        include: { contacts: true },
      });
      assert.ok(
        (
          await evaluateReadiness({
            ...target,
            leadId: duplicate.id,
            contactId: duplicate.contacts[0].id,
          })
        ).reasons.includes("SUPPRESSION_ACTIVE"),
      );
      await recordEvidence({ ...consent, requestId: randomUUID() });
      assert.ok(
        (await evaluateReadiness(target)).reasons.includes(
          "SUPPRESSION_ACTIVE",
        ),
      );
      assert.equal(
        await db.message.count({ where: { contactId: target.contactId } }),
        0,
      );
      const events = await db.auditEvent.findMany({
        where: { customerId: customer.id },
      });
      assert.ok(!JSON.stringify(events).includes("+12025550101"));
    } finally {
      await db.$disconnect();
    }
  },
);
