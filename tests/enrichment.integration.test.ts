import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../src/lib/db";
import {
  executeEnrichment,
  queueEnrichment,
  retryEnrichment,
  runEnrichmentWorker,
} from "../src/lib/enrichment/service";
import type { EnrichmentAdapter } from "../src/lib/enrichment/adapter";
import { SourceError } from "../src/lib/lead-sources/contract";
test(
  "isolated enrichment lifecycle, dedup, restrictions, leases, retries and disabled traffic",
  { skip: process.env.APS_ISOLATED_TEST_DB !== "true" },
  async () => {
    const old = process.env.APS_ENRICHMENT_ENABLED;
    const customer = await db.customer.create({
      data: { name: "Step5 synthetic only", slug: `step5-${randomUUID()}` },
    });
    const campaign = await db.campaign.create({
      data: {
        customerId: customer.id,
        name: "Synthetic enrichment",
        industry: "roofing",
        status: "RUNNING",
      },
    });
    const fixture = async () => {
      const lead = await db.lead.create({
        data: {
          customerId: customer.id,
          properties: {
            create: {
              address1: "101 Synthetic Street",
              city: "Austin",
              state: "TX",
              postalCode: "78704",
            },
          },
          campaignLeads: { create: { campaignId: campaign.id } },
        },
        include: { properties: true },
      });
      return { lead, property: lead.properties[0] };
    };
    let calls = 0;
    const adapter: EnrichmentAdapter = {
      lookup: async () => {
        calls++;
        await new Promise((r) => setTimeout(r, 70));
        return {
          matched: true,
          rejected: 0,
          contacts: [
            {
              type: "MOBILE",
              value: "+12025550101",
              dnc: true,
              restricted: false,
            },
            {
              type: "EMAIL",
              value: "test@example.invalid",
              dnc: false,
              restricted: false,
            },
          ],
        };
      },
    };
    try {
      const { lead, property } = await fixture();
      const existingContact = await db.contact.create({
        data: {
          leadId: lead.id,
          type: "OTHER",
          value: "+12025550101",
          normalizedValue: "+12025550101",
          isValid: false,
          metadata: { original: true },
          consents: {
            create: {
              channel: "SMS",
              status: "REVOKED",
              source: "synthetic-opt-out",
            },
          },
        },
      });
      const queue = () => queueEnrichment(campaign.id, lead.id, property.id);
      const [a, b] = await Promise.all([queue(), queue()]);
      assert.equal(a.jobId, b.jobId);
      delete process.env.APS_ENRICHMENT_ENABLED;
      assert.deepEqual(await runEnrichmentWorker(), {
        enabled: false,
        job: null,
      });
      assert.equal(
        (await executeEnrichment(a.jobId, adapter)).error,
        "ENRICHMENT_DISABLED",
      );
      assert.equal(calls, 0);
      process.env.APS_ENRICHMENT_ENABLED = "true";
      await retryEnrichment(a.jobId, false);
      await Promise.all([
        executeEnrichment(a.jobId, adapter),
        executeEnrichment(a.jobId, adapter),
      ]);
      assert.equal(calls, 1);
      assert.equal(
        (await executeEnrichment(a.jobId, adapter)).status,
        "SUCCEEDED",
      );
      assert.equal(calls, 1);
      assert.equal(await db.contact.count({ where: { leadId: lead.id } }), 2);
      assert.equal(
        await db.suppression.count({
          where: { leadId: lead.id, reason: "DNC" },
        }),
        1,
      );
      assert.equal(
        await db.consent.count({ where: { contact: { leadId: lead.id } } }),
        1,
      );
      const preserved = await db.contact.findUniqueOrThrow({
        where: { id: existingContact.id },
        include: { consents: true },
      });
      assert.equal(preserved.isValid, false);
      assert.deepEqual(preserved.metadata, { original: true });
      assert.equal(preserved.consents[0].status, "REVOKED");
      assert.equal(
        (await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).status,
        "NEW",
      );
      assert.equal(
        await db.message.count({ where: { contact: { leadId: lead.id } } }),
        0,
      );
      const other = await db.campaign.create({
        data: {
          customerId: customer.id,
          name: "Same lead",
          industry: "roofing",
          status: "RUNNING",
        },
      });
      await db.campaignLead.create({
        data: { campaignId: other.id, leadId: lead.id },
      });
      assert.equal(
        (await queueEnrichment(other.id, lead.id, property.id)).jobId,
        a.jobId,
      );
      const second = await fixture();
      const c = await queueEnrichment(
        campaign.id,
        second.lead.id,
        second.property.id,
      );
      await executeEnrichment(c.jobId, {
        lookup: async () => {
          throw new SourceError("PROVIDER_OUTCOME_UNKNOWN", "blocked");
        },
      });
      await assert.rejects(retryEnrichment(c.jobId, false), /ACK_REQUIRED/);
      await retryEnrichment(c.jobId, true);
      await db.providerJob.update({
        where: { id: c.jobId },
        data: {
          status: "RUNNING",
          leaseToken: randomUUID(),
          leaseExpiresAt: new Date(0),
        },
      });
      assert.equal(
        (await executeEnrichment(c.jobId, adapter)).error,
        "PROVIDER_OUTCOME_UNKNOWN",
      );
      assert.equal(calls, 1);
      const third = await fixture();
      const d = await queueEnrichment(
        campaign.id,
        third.lead.id,
        third.property.id,
      );
      await executeEnrichment(d.jobId, {
        lookup: async () => {
          throw new SourceError("PROVIDER_RATE_LIMIT", "retry", 100);
        },
      });
      assert.equal(
        (await db.providerJob.findUniqueOrThrow({ where: { id: d.jobId } }))
          .status,
        "QUEUED",
      );
      await executeEnrichment(d.jobId, adapter);
      assert.equal(calls, 1);
      await db.providerJob.update({
        where: { id: d.jobId },
        data: { nextAttemptAt: null },
      });
      await executeEnrichment(d.jobId, {
        lookup: async () => {
          await db.campaign.update({
            where: { id: campaign.id },
            data: { status: "PAUSED" },
          });
          return {
            matched: true,
            rejected: 0,
            contacts: [
              {
                type: "EMAIL",
                value: "never@example.invalid",
                dnc: false,
                restricted: false,
              },
            ],
          };
        },
      });
      assert.equal(
        await db.contact.count({ where: { leadId: third.lead.id } }),
        0,
      );
      assert.equal(
        (await db.providerJob.findUniqueOrThrow({ where: { id: d.jobId } }))
          .status,
        "BLOCKED",
      );
      assert.equal(
        await db.sourceReceipt.count({ where: { jobId: d.jobId } }),
        0,
      );
      await assert.rejects(
        queueEnrichment(other.id, third.lead.id, third.property.id),
        /NOT_ENROLLED/,
      );
      const audit = await db.auditEvent.findMany({
        where: { customerId: customer.id },
      });
      assert.equal(
        JSON.stringify(audit).includes("test@example.invalid"),
        false,
      );
    } finally {
      if (old === undefined) delete process.env.APS_ENRICHMENT_ENABLED;
      else process.env.APS_ENRICHMENT_ENABLED = old;
      await db.$disconnect();
    }
  },
);
