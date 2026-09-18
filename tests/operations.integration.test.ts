import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../src/lib/db";
import { getOperations } from "../src/lib/operations/service";
test(
  "operations selects the right customer, bounds lists and excludes confidential fields",
  { skip: process.env.APS_ISOLATED_TEST_DB !== "true" },
  async () => {
    try {
      const slug = `step7-${randomUUID()}`;
      const customer = await db.customer.create({
        data: { name: "Step7 synthetic", slug },
      });
      const campaign = await db.campaign.create({
        data: {
          name: "Dashboard verification",
          industry: "roofing",
          customerId: customer.id,
        },
      });
      await db.lead.create({
        data: {
          customerId: customer.id,
          firstName: "HiddenOwner",
          campaignLeads: { create: { campaignId: campaign.id } },
          contacts: {
            create: {
              type: "EMAIL",
              value: "hidden@example.invalid",
              normalizedValue: "hidden@example.invalid",
            },
          },
        },
      });
      await db.providerJob.create({
        data: {
          campaignId: campaign.id,
          provider: "TEST",
          jobType: "SOURCE_LEADS",
          status: "BLOCKED",
          input: { secret: "hidden-provider-payload" },
          error: "private-provider-error",
        },
      });
      await db.auditEvent.create({
        data: {
          customerId: customer.id,
          campaignId: campaign.id,
          eventType: "synthetic.created",
          actorType: "TEST",
          payload: { secret: "hidden-evidence" },
        },
      });
      const result = await getOperations({ search: slug });
      assert.equal(result.customers.length, 1);
      assert.equal(result.campaign?.id, campaign.id);
      assert.equal(result.leadCount, 1);
      assert.equal(result.contactCount, 1);
      assert.equal(result.jobs[0].status, "BLOCKED");
      assert.equal(result.setup.outreachEnabled, false);
      const output = JSON.stringify(result);
      for (const secret of [
        "HiddenOwner",
        "hidden@example.invalid",
        "hidden-provider-payload",
        "private-provider-error",
        "hidden-evidence",
      ])
        assert.ok(!output.includes(secret));
      const other = await db.customer.create({
        data: { name: "Other", slug: `step7-${randomUUID()}` },
      });
      await assert.rejects(
        getOperations({ customerId: other.id, campaignId: campaign.id }),
        /CAMPAIGN_NOT_FOUND/,
      );
      await assert.rejects(getOperations({ search: "x".repeat(101) }));
      const empty = await getOperations({ search: randomUUID() });
      assert.equal(empty.customer, null);
      assert.equal(empty.jobs.length, 0);
    } finally {
      await db.$disconnect();
    }
  },
);
