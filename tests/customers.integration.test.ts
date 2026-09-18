import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../src/lib/db";
import { campaignIntakeSchema } from "../src/lib/campaign-schema";
import {
  createCampaignIntake,
  CustomerIntakeError,
} from "../src/lib/campaign-service";
import { GET } from "../src/app/api/internal/customers/route";
import { POST } from "../src/app/api/campaigns/route";
import { createSession } from "../src/lib/operations/session";

test(
  "saved customer lookup and intake preserve identity, privacy and login accounts",
  { skip: process.env.APS_ISOLATED_TEST_DB !== "true" },
  async () => {
    const oldKey = process.env.APS_INTERNAL_API_KEY;
    process.env.APS_INTERNAL_API_KEY = "customer-integration-test-only";
    const prefix = `Customer test ${randomUUID()}`;
    const ids: string[] = [];
    let userId: string | undefined;
    try {
      const customer = await db.customer.create({
        data: {
          name: prefix,
          slug: `customer-${randomUUID()}`,
          contactName: "Synthetic Person",
          contactEmail: `${randomUUID()}@example.invalid`,
          websiteUrl: "https://example.invalid",
          timezone: "America/Chicago",
        },
      });
      ids.push(customer.id);
      const duplicate = await db.customer.create({
        data: {
          name: prefix,
          slug: `customer-${randomUUID()}`,
          contactName: "Other Person",
          contactEmail: `${randomUUID()}@example.invalid`,
        },
      });
      ids.push(duplicate.id);
      const user = await db.user.create({
        data: {
          email: customer.contactEmail!,
          name: "Operator must remain",
          role: "APS_ADMIN",
          isActive: false,
        },
      });
      userId = user.id;
      const input = campaignIntakeSchema.parse({
        customer: { ...customer, id: undefined },
        campaign: {
          name: "Synthetic draft",
          industry: "roofing",
          propertyUse: "RESIDENTIAL",
          desiredLeadCount: 25,
          serviceLevel: "DATA_ONLY",
          channels: { sms: false, email: false, calling: false },
        },
        territories: [{ type: "STATE", value: "IL" }],
        targeting: {},
      });
      const url = `http://localhost/api/internal/customers?q=${encodeURIComponent(prefix)}`;
      assert.equal((await GET(new Request(url))).status, 401);
      const cookie = `aps_operations=${createSession()}`;
      const search = await GET(new Request(url, { headers: { cookie } }));
      assert.match(search.headers.get("cache-control")!, /no-store/);
      const matches = (await search.json()).customers;
      assert.equal(matches.length, 2);
      assert.deepEqual(
        new Set(matches.map((c: { id: string }) => c.id)),
        new Set(ids),
      );
      assert.equal(
        matches.find((c: { id: string }) => c.id === customer.id).contactName,
        customer.contactName,
      );
      assert.equal(matches[0].users, undefined);
      assert.deepEqual(
        (
          await (
            await GET(
              new Request("http://localhost/api/internal/customers?q=a", {
                headers: { cookie },
              }),
            )
          ).json()
        ).customers,
        [],
      );
      const linked = {
        ...input,
        customer: { ...input.customer, id: customer.id },
      };
      const request = (headers: Record<string, string> = {}) =>
        new Request("http://localhost/api/campaigns", {
          method: "POST",
          headers: { "content-type": "application/json", ...headers },
          body: JSON.stringify(linked),
        });
      assert.equal((await POST(request())).status, 401);
      assert.equal((await POST(request({ cookie }))).status, 401);
      await assert.rejects(
        createCampaignIntake(linked),
        (error: unknown) =>
          error instanceof CustomerIntakeError && error.status === 401,
      );
      const response = await POST(
        request({ "x-aps-internal-key": process.env.APS_INTERNAL_API_KEY! }),
      );
      assert.equal(response.status, 201);
      const result = await response.json();
      assert.equal(result.customerId, customer.id);
      assert.equal(result.status, "DRAFT");
      assert.equal(
        (
          await db.campaign.findUniqueOrThrow({
            where: { id: result.campaignId },
          })
        ).customerId,
        customer.id,
      );
      assert.equal(
        await db.providerJob.count({
          where: { campaignId: result.campaignId },
        }),
        0,
      );
      assert.equal(
        await db.auditEvent.count({
          where: {
            campaignId: result.campaignId,
            eventType: "campaign.created",
          },
        }),
        1,
      );
      const publicResult = await createCampaignIntake(input);
      ids.push(publicResult.customerId);
      assert.notEqual(publicResult.customerId, customer.id);
      assert.deepEqual(
        await db.customer.findUnique({ where: { id: customer.id } }),
        customer,
      );
      assert.deepEqual(
        await db.user.findUnique({ where: { id: user.id } }),
        user,
      );
      await assert.rejects(
        createCampaignIntake(
          {
            ...linked,
            customer: { ...linked.customer, contactName: "Tampered Name" },
          },
          true,
        ),
        (error: unknown) =>
          error instanceof CustomerIntakeError && error.status === 409,
      );
      await db.customer.update({
        where: { id: customer.id },
        data: { status: "PAUSED" },
      });
      await assert.rejects(
        createCampaignIntake(linked, true),
        (error: unknown) =>
          error instanceof CustomerIntakeError && error.status === 409,
      );
      await assert.rejects(
        createCampaignIntake(
          { ...linked, customer: { ...linked.customer, id: randomUUID() } },
          true,
        ),
        (error: unknown) =>
          error instanceof CustomerIntakeError && error.status === 404,
      );
    } finally {
      await db.auditEvent.deleteMany({ where: { customerId: { in: ids } } });
      await db.campaign.deleteMany({ where: { customerId: { in: ids } } });
      await db.customer.deleteMany({ where: { id: { in: ids } } });
      if (userId) await db.user.delete({ where: { id: userId } });
      if (oldKey === undefined) delete process.env.APS_INTERNAL_API_KEY;
      else process.env.APS_INTERNAL_API_KEY = oldKey;
      await db.$disconnect();
    }
  },
);
