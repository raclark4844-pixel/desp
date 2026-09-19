import test from "node:test";
import assert from "node:assert/strict";
import { db } from "../src/lib/db";
import {
  campaignPreparation,
  preparationIssue,
} from "../src/lib/campaign-preparation";
import { GET } from "../src/app/api/campaigns/[campaignId]/prepare/route";

test("pre-collection review requires every channel draft and rejects stale or unacknowledged setup", async (t) => {
  const original = db.campaign.findUnique;
  t.after(() => {
    db.campaign.findUnique = original;
  });
  const campaignId = "00000000-0000-4000-8000-000000000001";
  const fixture = {
    id: campaignId,
    customerId: "customer",
    name: "Roofing",
    industry: "ROOFING",
    desiredLeadCount: 20,
    customer: { name: "Sample Exterior Company" },
    smsSender: null,
    territories: [{ type: "ZIP", value: "12345" }],
    targetingConfig: { propertyType: "single-family" },
    residential: true,
    commercial: false,
    outreachConfig: {
      requestedChannels: { sms: true, email: true, calling: false },
    },
    outboundBatches: [
      {
        id: "draft1",
        channel: "SMS",
        status: "DRAFT",
        subject: "",
        body: "Would you like information about our services?",
        mailingAddress: "123 Example Street",
        recipientTimezone: "America/New_York",
        updatedAt: new Date("2026-09-18T12:00:00Z"),
      },
    ],
  };
  db.campaign.findUnique = (async () => fixture) as unknown as typeof original;
  const first = (await campaignPreparation(campaignId))!;
  assert.equal(first.messagesReady, false);
  assert.equal(first.messages.length, 2);
  assert.match(first.messages[0].preview, /^Sample Exterior Company:/);
  assert.match(first.messages[0].preview, /Reply STOP to opt out\./);
  assert.match(
    preparationIssue(first, first.reviewToken, true)!,
    /every selected channel/,
  );
  fixture.outboundBatches.push({
    ...fixture.outboundBatches[0],
    id: "draft2",
    channel: "EMAIL",
    subject: "Your exterior project",
  });
  const ready = (await campaignPreparation(campaignId))!;
  assert.equal(ready.messagesReady, true);
  assert.match(ready.messages[1].preview, /Advertisement from/);
  assert.match(ready.messages[1].preview, /personal unsubscribe link/);
  assert.match(preparationIssue(ready, first.reviewToken, true)!, /changed/);
  assert.match(
    preparationIssue(ready, ready.reviewToken, false)!,
    /unresolved sending setup/,
  );
  assert.equal(preparationIssue(ready, ready.reviewToken, true), null);
  fixture.outboundBatches[0].body =
    "A revised message that must be reviewed again.";
  const changed = (await campaignPreparation(campaignId))!;
  assert.notEqual(changed.reviewToken, ready.reviewToken);
  assert.match(preparationIssue(changed, ready.reviewToken, true)!, /changed/);
  fixture.outboundBatches[0].recipientTimezone = "invalid/timezone";
  assert.equal((await campaignPreparation(campaignId))!.messagesReady, false);
  const denied = await GET(
    new Request("https://example.invalid/api/campaigns/test/prepare"),
    { params: Promise.resolve({ campaignId }) },
  );
  assert.equal(denied.status, 401);
});
