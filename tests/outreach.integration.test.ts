import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { db } from "../src/lib/db";
import {
  createDraft,
  controlBatch,
  dispatchNext,
} from "../src/lib/outreach/service";
import { recordEvidence } from "../src/lib/compliance/service";
import {
  twilioWebhook,
  resendWebhook,
  unsubscribe,
  suppressRecipient,
} from "../src/lib/outreach/webhooks";
import {
  DeliveryError,
  type DeliveryInput,
} from "../src/lib/outreach/provider";
import {
  GET as sendingGet,
  PATCH as sendingPatch,
} from "../src/app/api/sending/route";
import type { SendChannel } from "../src/lib/outreach/policy";
test(
  "isolated sending: gates, sequential channels, concurrency, opt-outs, callbacks and uncertain delivery",
  { skip: process.env.APS_ISOLATED_TEST_DB !== "true" },
  async () => {
    const original = { ...process.env };
    const customers: string[] = [];
    Object.assign(process.env, {
      VERCEL_ENV: "production",
      OUTREACH_ENABLED: "false",
      OUTREACH_SMS_ENABLED: "true",
      OUTREACH_EMAIL_ENABLED: "true",
      OUTREACH_CALL_ENABLED: "true",
      OUTREACH_SMS_SETUP_VERIFIED: "true",
      OUTREACH_EMAIL_SETUP_VERIFIED: "true",
      OUTREACH_CALL_SETUP_VERIFIED: "true",
      OUTREACH_PUBLIC_URL: "https://test.example",
      TWILIO_ACCOUNT_SID: "ACtest",
      TWILIO_AUTH_TOKEN: "synthetic",
      TWILIO_MESSAGING_SERVICE_SID: "MGtest",
      TWILIO_VOICE_FROM: "+12025550100",
      OUTREACH_AGENT_PHONE: "+12025550102",
      FTC_SAN: "synthetic",
      FTC_ORGANIZATION_ID: "synthetic",
      FTC_SAN_EXPIRES_AT: "2099-01-01",
      RESEND_API_KEY: "synthetic",
      RESEND_WEBHOOK_SECRET:
        "whsec_" + Buffer.from("synthetic").toString("base64"),
      OUTREACH_FROM_EMAIL: "sender@example.com",
      OUTREACH_REPLY_TO: "reply@example.com",
    });
    async function fixture() {
      const c = await db.customer.create({
        data: { name: "Synthetic Sending", slug: randomUUID() },
      });
      customers.push(c.id);
      process.env.OUTREACH_CUSTOMER_ID = c.id;
      const campaign = await db.campaign.create({
        data: {
          customerId: c.id,
          name: "Synthetic campaign",
          industry: "roofing",
          status: "READY",
          outreachConfig: {
            requestedChannels: { sms: true, email: true, calling: true },
          },
        },
      });
      const lead = await db.lead.create({
        data: {
          customerId: c.id,
          campaignLeads: { create: { campaignId: campaign.id } },
          contacts: {
            create: [
              {
                type: "MOBILE",
                value: "+12025550101",
                normalizedValue: "+12025550101",
              },
              {
                type: "EMAIL",
                value: "synthetic@example.com",
                normalizedValue: "synthetic@example.com",
              },
            ],
          },
        },
        include: { contacts: true },
      });
      return { c, campaign, lead };
    }
    async function evidence(
      f: Awaited<ReturnType<typeof fixture>>,
      channel: SendChannel,
    ) {
      const contact = f.lead.contacts.find((c) =>
        channel === "EMAIL" ? c.type === "EMAIL" : c.type === "MOBILE",
      )!;
      const base = {
        campaignId: f.campaign.id,
        leadId: f.lead.id,
        contactId: contact.id,
        channel,
        actorRef: "synthetic-admin",
        evidenceRef: "synthetic-evidence",
        observedAt: new Date(Date.now() - 1000).toISOString(),
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      };
      await recordEvidence({
        ...base,
        requestId: randomUUID(),
        action: "CONSENT",
        status: "GRANTED",
      });
      for (const check of [
        "CONTACT_OWNERSHIP",
        "JURISDICTION_REVIEW",
        ...(channel === "EMAIL"
          ? ["EMAIL_DELIVERABILITY"]
          : ["DNC", "REASSIGNED_NUMBER"]),
      ])
        await recordEvidence({
          ...base,
          requestId: randomUUID(),
          action: "CHECK",
          check,
          outcome: "PASS",
        });
    }
    async function batch(
      f: Awaited<ReturnType<typeof fixture>>,
      channel: SendChannel,
    ) {
      const id = await createDraft(
        {
          campaignId: f.campaign.id,
          channel,
          subject: "Synthetic subject",
          body: "Synthetic test message only",
          mailingAddress: "123 Synthetic Street",
          recipientTimezone: "America/Los_Angeles",
        },
        "test-admin",
      );
      const b = await db.outboundBatch.findUniqueOrThrow({ where: { id } });
      await controlBatch(
        {
          id,
          action: "APPROVE",
          confirmReview: true,
          expectedUpdatedAt: b.updatedAt.toISOString(),
        },
        "test-admin",
      );
      return id;
    }
    function twilio(
      id: string,
      action: string,
      fields: Record<string, string>,
    ) {
      const url = `https://test.example/api/outreach/twilio?id=${id}&action=${action}`;
      const params = new URLSearchParams({ AccountSid: "ACtest", ...fields });
      const signature = createHmac("sha1", "synthetic")
        .update(
          url +
            [...params.keys()]
              .sort()
              .map((k) => k + params.get(k))
              .join(""),
        )
        .digest("base64");
      return new Request(url, {
        method: "POST",
        headers: { "x-twilio-signature": signature },
        body: params,
      });
    }
    const sent: DeliveryInput[] = [];
    const adapter = {
      send: async (input: DeliveryInput) => {
        sent.push(input);
        return `mock-${input.id}`;
      },
    };
    try {
      assert.equal(
        (await sendingGet(new Request("https://test.example/api/sending")))
          .status,
        401,
      );
      assert.equal(
        (
          await sendingPatch(
            new Request("https://test.example/api/sending", {
              method: "PATCH",
            }),
          )
        ).status,
        401,
      );
      const f = await fixture();
      const email = await batch(f, "EMAIL"),
        call = await batch(f, "CALL"),
        sms = await batch(f, "SMS");
      assert.equal(
        (await dispatchNext(adapter)).reason,
        "LIVE_SENDING_DISABLED",
      );
      assert.equal(sent.length, 0);
      process.env.OUTREACH_ENABLED = "true";
      assert.equal((await dispatchNext(adapter)).reason, "RECIPIENT_BLOCKED");
      await dispatchNext(adapter);
      assert.equal(
        (await db.outboundBatch.findUniqueOrThrow({ where: { id: sms } }))
          .status,
        "REVIEW",
      );
      await evidence(f, "SMS");
      await controlBatch({ id: sms, action: "RESUME" }, "test-admin");
      await controlBatch({ id: sms, action: "PAUSE" }, "test-admin");
      assert.equal(
        (await dispatchNext(adapter)).reason,
        "QUEUE_PAUSED_FOR_REVIEW",
      );
      await controlBatch({ id: sms, action: "RESUME" }, "test-admin");
      await Promise.all([dispatchNext(adapter), dispatchNext(adapter)]);
      assert.equal(sent.length, 1);
      assert.equal(sent[0].channel, "SMS");
      await assert.rejects(
        createDraft(
          {
            campaignId: f.campaign.id,
            channel: "SMS",
            subject: "",
            body: "Changed content",
            mailingAddress: "123 Synthetic Street",
            recipientTimezone: "America/Los_Angeles",
          },
          "test-admin",
        ),
      );
      const r = await db.outboundRecipient.findFirstOrThrow({
        where: { batchId: sms },
      });
      const status = () =>
        twilio(r.id, "status", {
          MessageSid: `mock-${r.id}`,
          To: r.destination,
          MessageStatus: "delivered",
        });
      assert.equal((await twilioWebhook(status())).status, 200);
      await twilioWebhook(status());
      await twilioWebhook(
        twilio(r.id, "status", {
          MessageSid: `mock-${r.id}`,
          To: r.destination,
          MessageStatus: "failed",
        }),
      );
      assert.equal(
        (await db.outboundRecipient.findUniqueOrThrow({ where: { id: r.id } }))
          .status,
        "DELIVERED",
      );
      await db.outboundBatch.update({
        where: { id: sms },
        data: { lastDispatchAt: null },
      });
      assert.equal((await dispatchNext(adapter)).reason, "BATCH_COMPLETED");
      assert.equal(
        (await dispatchNext(adapter)).reason,
        "RECIPIENT_24_HOUR_SPACING",
      );
      await db.outboundRecipient.update({
        where: { id: r.id },
        data: { attemptedAt: new Date(Date.now() - 2 * 86400000) },
      });
      await evidence(f, "EMAIL");
      await dispatchNext(adapter);
      assert.equal(sent.length, 2);
      assert.equal(sent[1].channel, "EMAIL");
      const er = await db.outboundRecipient.findFirstOrThrow({
        where: { batchId: email },
      });
      assert.equal(await unsubscribe(er.unsubscribeToken), true);
      assert.equal(await unsubscribe(er.unsubscribeToken), true);
      const event = JSON.stringify({
          type: "email.delivered",
          data: { email_id: `mock-${er.id}` },
        }),
        ts = String(Math.floor(Date.now() / 1000));
      const headers = {
        "svix-id": "test-event",
        "svix-timestamp": ts,
        "svix-signature":
          "v1," +
          createHmac("sha256", "synthetic")
            .update(`test-event.${ts}.${event}`)
            .digest("base64"),
      };
      assert.equal(
        (
          await resendWebhook(
            new Request("https://test.example/api/outreach/resend", {
              method: "POST",
              headers,
              body: event,
            }),
          )
        ).status,
        200,
      );
      await db.outboundBatch.update({
        where: { id: email },
        data: { lastDispatchAt: null },
      });
      await dispatchNext(adapter);
      await db.outboundRecipient.update({
        where: { id: er.id },
        data: { attemptedAt: new Date(Date.now() - 2 * 86400000) },
      });
      await evidence(f, "CALL");
      assert.equal((await dispatchNext(adapter)).reason, "RECIPIENT_BLOCKED");
      assert.equal(sent.length, 2);
      await controlBatch({ id: call, action: "CANCEL" }, "test-admin");
      const f2 = await fixture();
      const uncertain = await batch(f2, "SMS");
      await evidence(f2, "SMS");
      let attempts = 0;
      const uncertainAdapter = {
        send: async () => {
          attempts++;
          throw new DeliveryError("UNKNOWN");
        },
      };
      assert.equal((await dispatchNext(uncertainAdapter)).reason, "UNKNOWN");
      await dispatchNext(uncertainAdapter);
      assert.equal(attempts, 1);
      await assert.rejects(
        controlBatch({ id: uncertain, action: "RESUME" }, "test-admin"),
      );
      await controlBatch({ id: uncertain, action: "CANCEL" }, "test-admin");
      const f3 = await fixture();
      const phone = await batch(f3, "CALL");
      await evidence(f3, "CALL");
      await dispatchNext(adapter);
      const pr = await db.outboundRecipient.findFirstOrThrow({
        where: { batchId: phone },
      });
      const callFields = {
        CallSid: `mock-${pr.id}`,
        To: process.env.OUTREACH_AGENT_PHONE!,
      };
      assert.ok(
        (
          await (await twilioWebhook(twilio(pr.id, "voice", callFields))).text()
        ).includes("Press 1"),
      );
      assert.ok(
        (
          await (
            await twilioWebhook(
              twilio(pr.id, "bridge", { ...callFields, Digits: "1" }),
            )
          ).text()
        ).includes("<Dial"),
      );
      assert.ok(
        !(
          await (
            await twilioWebhook(
              twilio(pr.id, "bridge", { ...callFields, Digits: "1" }),
            )
          ).text()
        ).includes("<Dial"),
      );
      await twilioWebhook(
        twilio(pr.id, "call-result", {
          ...callFields,
          DialCallStatus: "completed",
        }),
      );
      assert.equal(
        (await db.outboundRecipient.findUniqueOrThrow({ where: { id: pr.id } }))
          .status,
        "COMPLETED",
      );
      await db.outboundBatch.update({
        where: { id: phone },
        data: { lastDispatchAt: null },
      });
      await dispatchNext(adapter);
      const duplicateCampaign = await db.campaign.create({
        data: {
          customerId: f3.c.id,
          name: "Synthetic duplicate campaign",
          industry: "roofing",
          status: "READY",
          outreachConfig: {
            requestedChannels: { sms: true, email: true, calling: true },
          },
          campaignLeads: { create: { leadId: f3.lead.id } },
        },
      });
      const duplicateFixture = { ...f3, campaign: duplicateCampaign };
      const duplicate = await batch(duplicateFixture, "CALL");
      await evidence(duplicateFixture, "CALL");
      await db.outboundRecipient.update({
        where: { id: pr.id },
        data: { attemptedAt: new Date(Date.now() - 2 * 86400000) },
      });
      await dispatchNext(adapter);
      assert.equal(
        (
          await db.outboundRecipient.findFirstOrThrow({
            where: { batchId: duplicate },
          })
        ).status,
        "SKIPPED",
      );
      await dispatchNext(adapter);
      const f4 = await fixture();
      const rate = await batch(f4, "SMS");
      await evidence(f4, "SMS");
      let rejected = 0;
      for (let i = 0; i < 3; i++) {
        await dispatchNext({
          send: async () => {
            rejected++;
            throw new DeliveryError("RATE_LIMITED");
          },
        });
        await db.outboundBatch.update({
          where: { id: rate },
          data: { lastDispatchAt: null },
        });
        await db.outboundRecipient.updateMany({
          where: { batchId: rate },
          data: { nextAttemptAt: null },
        });
      }
      await suppressRecipient(pr.id,"synthetic-employee");
    assert.ok(await db.suppression.findFirst({where:{leadId:f3.lead.id,reason:"OPT_OUT"}}));
    assert.equal(rejected, 3);
      assert.equal(
        (
          await db.outboundRecipient.findFirstOrThrow({
            where: { batchId: rate },
          })
        ).status,
        "FAILED",
      );
    } finally {
      const batches = await db.outboundBatch.findMany({
        where: { campaign: { customerId: { in: customers } } },
        select: { id: true },
      });
      const ids = batches.map((b) => b.id);
      const rs = await db.outboundRecipient.findMany({
        where: { batchId: { in: ids } },
        select: { id: true },
      });
      await db.outboundReservation.deleteMany({
        where: { recipientId: { in: rs.map((r) => r.id) } },
      });
      await db.outboundRecipient.deleteMany({
        where: { batchId: { in: ids } },
      });
      await db.outboundBatch.deleteMany({ where: { id: { in: ids } } });
      await db.customer.deleteMany({ where: { id: { in: customers } } });
      process.env = original;
      await db.$disconnect();
    }
  },
);
