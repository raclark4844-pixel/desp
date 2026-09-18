import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { db } from "../src/lib/db";
import { newSession } from "../src/lib/employee/auth";
import { receiveSms, receiveEmail } from "../src/lib/inbox/receive";
import { assignSender } from "../src/lib/inbox/senders";
import {
  saveReply,
  sendReply,
  saveTarget,
  saveKnowledge,
  updateConversation,
} from "../src/lib/inbox/service";
import { setAiSession } from "../src/lib/inbox/ai-session";
import { suggestReply } from "../src/lib/inbox/ai";
import { dispatchNotification } from "../src/lib/inbox/notifications";
import { twilioWebhook } from "../src/lib/outreach/webhooks";
import { recordEvidence } from "../src/lib/compliance/service";
import {
  createDraft,
  controlBatch,
  dispatchNext,
} from "../src/lib/outreach/service";
import {
  DeliveryError,
  deliveryAdapter,
  type DeliveryInput,
} from "../src/lib/outreach/provider";
import { GET, POST } from "../src/app/api/inbox/route";

test(
  "isolated inbox: routing, sender snapshots, replay, permissions, replies, notifications and AI drafts",
  { skip: process.env.APS_ISOLATED_TEST_DB !== "true" },
  async () => {
    const original = { ...process.env },
      originalFetch = global.fetch;
    const customers: string[] = [],
      employees: string[] = [],
      receiptKeys: string[] = [];
    const sent: DeliveryInput[] = [];
    Object.assign(process.env, {
      VERCEL_ENV: "production",
      OUTREACH_ENABLED: "true",
      OUTREACH_SMS_ENABLED: "true",
      OUTREACH_SMS_SETUP_VERIFIED: "true",
      OUTREACH_PUBLIC_URL: "https://test.example",
      TWILIO_ACCOUNT_SID: "ACtest",
      TWILIO_AUTH_TOKEN: "synthetic",
      TWILIO_MESSAGING_SERVICE_SID: "MGtest",
      FTC_SAN: "synthetic",
      FTC_ORGANIZATION_ID: "synthetic",
      FTC_SAN_EXPIRES_AT: "2099-01-01",
      INBOX_NOTIFICATIONS_ENABLED: "false",
      INBOX_AI_ENABLED: "false",
    });
    global.fetch = async () => {
      throw new Error("Unexpected external API request");
    };
    try {
      const customer = await db.customer.create({
        data: { name: "Synthetic Inbox", slug: randomUUID() },
      });
      customers.push(customer.id);
      process.env.OUTREACH_CUSTOMER_ID = customer.id;
      const employee = await db.employee.create({
        data: {
          name: "Synthetic Operator",
          username: randomUUID(),
          email: `${randomUUID()}@example.com`,
          passwordHash: "unused",
          mustChangePassword: false,
        },
      });
      employees.push(employee.id);
      const campaign = await db.campaign.create({
        data: {
          customerId: customer.id,
          name: "Synthetic Region",
          industry: "roofing",
          status: "READY",
          outreachConfig: { requestedChannels: { sms: true, email: true } },
        },
      });
      const sender = await db.smsSender.create({
        data: {
          phone: "+12025550999",
          label: "Synthetic DC",
          customerId: customer.id,
          serviceSid: "MGtest",
          verifiedAt: new Date(),
        },
      });
      await assignSender(
        { campaignId: campaign.id, senderId: sender.id },
        employee.id,
      );
      const lead = await db.lead.create({
        data: {
          customerId: customer.id,
          campaignLeads: { create: { campaignId: campaign.id } },
          contacts: {
            create: {
              type: "MOBILE",
              value: "+12025550111",
              normalizedValue: "+12025550111",
            },
          },
        },
        include: { contacts: true },
      });
      const contact = lead.contacts[0];
      const evidence = {
        campaignId: campaign.id,
        leadId: lead.id,
        contactId: contact.id,
        channel: "SMS",
        actorRef: "synthetic",
        evidenceRef: "synthetic",
        observedAt: new Date(Date.now() - 1000).toISOString(),
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      };
      await recordEvidence({
        ...evidence,
        requestId: randomUUID(),
        action: "CONSENT",
        status: "GRANTED",
      });
      for (const check of [
        "CONTACT_OWNERSHIP",
        "JURISDICTION_REVIEW",
        "DNC",
        "REASSIGNED_NUMBER",
      ])
        await recordEvidence({
          ...evidence,
          requestId: randomUUID(),
          action: "CHECK",
          check,
          outcome: "PASS",
        });
      const batchId = await createDraft(
        {
          campaignId: campaign.id,
          channel: "SMS",
          body: "Synthetic campaign introduction",
          mailingAddress: "123 Synthetic Street",
          recipientTimezone: "America/Los_Angeles",
        },
        employee.id,
      );
      const batch = await db.outboundBatch.findUniqueOrThrow({
        where: { id: batchId },
      });
      await controlBatch(
        {
          id: batchId,
          action: "APPROVE",
          confirmReview: true,
          expectedUpdatedAt: batch.updatedAt.toISOString(),
        },
        employee.id,
      );
      assert.equal(
        (await db.outboundBatch.findUniqueOrThrow({ where: { id: batchId } }))
          .smsFrom,
        sender.phone,
      );
      await assert.rejects(
        assignSender({ campaignId: campaign.id, senderId: null }, employee.id),
      );
      const adapter = {
        send: async (input: DeliveryInput) => {
          sent.push(input);
          return "SM" + "a".repeat(32);
        },
      };
      assert.equal((await dispatchNext(adapter)).reason, "PROVIDER_ACCEPTED");
      assert.equal(sent[0].smsFrom, sender.phone);
      let c = await db.conversation.findFirstOrThrow({
        where: { campaignId: campaign.id },
      });
      await saveTarget(
        {
          campaignId: campaign.id,
          employeeId: employee.id,
          channel: "EMAIL",
          destination: employee.email,
          enabled: true,
          confirmPermission: true,
        },
        employee.id,
      );
      await saveTarget(
        {
          campaignId: campaign.id,
          employeeId: employee.id,
          channel: "SMS",
          destination: "+12025550112",
          enabled: true,
          confirmPermission: true,
        },
        employee.id,
      );
      const sid = "SM" + "b".repeat(32);
      receiptKeys.push(`twilio:${sid}`);
      const params = new URLSearchParams({
        AccountSid: "ACtest",
        From: contact.normalizedValue,
        To: sender.phone,
        MessageSid: sid,
        Body: "What days do you offer estimates?",
      });
      const url = "https://test.example/api/outreach/twilio?action=inbound";
      const signature = createHmac("sha1", "synthetic")
        .update(
          url +
            [...params.keys()]
              .sort()
              .map((k) => k + params.get(k))
              .join(""),
        )
        .digest("base64");
      assert.equal(
        (
          await twilioWebhook(
            new Request(url, { method: "POST", body: params }),
          )
        ).status,
        401,
      );
      for (let i = 0; i < 2; i++)
        assert.equal(
          (
            await twilioWebhook(
              new Request(url, {
                method: "POST",
                body: params,
                headers: { "x-twilio-signature": signature },
              }),
            )
          ).status,
          200,
        );
      assert.equal(
        await db.message.count({
          where: { conversationId: c.id, direction: "INBOUND" },
        }),
        1,
      );
      assert.equal(
        await db.replyNotification.count({
          where: { receiptKey: `twilio:${sid}` },
        }),
        2,
      );
      c = await db.conversation.findUniqueOrThrow({ where: { id: c.id } });
      assert.equal(c.campaignHold, true);
      assert.equal(c.needsReply, true);
      assert.equal(
        await db.suppression.count({ where: { customerId: customer.id } }),
        0,
      );
      const wrong = "SM" + "c".repeat(32);
      receiptKeys.push(`twilio:${wrong}`);
      await receiveSms(
        new URLSearchParams({
          From: contact.normalizedValue,
          To: "+12025550888",
          MessageSid: wrong,
          Body: "Hello",
        }),
      );
      assert.equal(
        (
          await db.inboxReceipt.findUniqueOrThrow({
            where: { key: `twilio:${wrong}` },
          })
        ).conversationId,
        null,
      );
      assert.equal(
        (await GET(new Request("https://test.example/api/inbox"))).status,
        401,
      );
      const session = newSession();
      await db.employeeSession.create({
        data: {
          tokenHash: session.tokenHash,
          employeeId: employee.id,
          expiresAt: session.expiresAt,
        },
      });
      const headers = {
        cookie: `ap_employee=${session.token}`,
        origin: "https://test.example",
        "content-type": "application/json",
      };
      assert.equal(
        (
          await POST(
            new Request("https://test.example/api/inbox", {
              method: "POST",
              headers,
              body: JSON.stringify({
                action: "ASSIGN_SENDER",
                payload: { campaignId: campaign.id, senderId: sender.id },
              }),
            }),
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await POST(
            new Request("https://test.example/api/inbox", {
              method: "POST",
              headers: { ...headers, origin: "https://evil.example" },
              body: "{}",
            }),
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await GET(
            new Request(`https://test.example/api/inbox?id=${c.id}`, {
              headers,
            }),
          )
        ).status,
        200,
      );
      const payload = {
        conversationId: c.id,
        requestId: randomUUID(),
        body: "We can ask our team about available estimate times.",
      };
      const replyId = await saveReply(payload, employee.id);
      assert.equal(await saveReply(payload, employee.id), replyId);
      await assert.rejects(
        saveReply({ ...payload, body: "changed" }, employee.id),
      );
      process.env.OUTREACH_ENABLED = "false";
      await assert.rejects(
        sendReply(
          {
            id: replyId,
            confirm: true,
            expectedUpdatedAt: c.updatedAt.toISOString(),
          },
          employee.id,
          adapter,
        ),
      );
      assert.equal(sent.length, 1);
      process.env.OUTREACH_ENABLED = "true";
      const outcomes = await Promise.allSettled([
        sendReply(
          {
            id: replyId,
            confirm: true,
            expectedUpdatedAt: c.updatedAt.toISOString(),
          },
          employee.id,
          adapter,
        ),
        sendReply(
          {
            id: replyId,
            confirm: true,
            expectedUpdatedAt: c.updatedAt.toISOString(),
          },
          employee.id,
          adapter,
        ),
      ]);
      assert.equal(outcomes.filter((o) => o.status === "fulfilled").length, 1);
      assert.equal(sent.length, 2);
      assert.equal(sent[1].smsFrom, sender.phone);
      assert.equal(sent[1].inboxReply, true);
      // Signed delivery callbacks must match the original local number and destination.
      const replyCallback = (from: string) => {
        const callbackUrl = `https://test.example/api/outreach/twilio?reply=${replyId}&action=status`;
        const values = new URLSearchParams({
          AccountSid: "ACtest",
          From: from,
          To: contact.normalizedValue,
          MessageSid: "SM" + "a".repeat(32),
          MessageStatus: "delivered",
        });
        const signed = createHmac("sha1", "synthetic")
          .update(
            callbackUrl +
              [...values.keys()]
                .sort()
                .map((k) => k + values.get(k))
                .join(""),
          )
          .digest("base64");
        return new Request(callbackUrl, {
          method: "POST",
          body: values,
          headers: { "x-twilio-signature": signed },
        });
      };
      assert.equal(
        (await twilioWebhook(replyCallback("+12025550888"))).status,
        400,
      );
      assert.equal(
        (await twilioWebhook(replyCallback(sender.phone))).status,
        200,
      );
      assert.equal(
        (await db.inboxReply.findUniqueOrThrow({ where: { id: replyId } }))
          .status,
        "DELIVERED",
      );
      await db.inboxReply.update({
        where: { id: replyId },
        data: { updatedAt: new Date(Date.now() - 120000) },
      });
      const uncertain = await saveReply(
        {
          conversationId: c.id,
          requestId: randomUUID(),
          body: "Synthetic uncertain reply",
        },
        employee.id,
      );
      c = await db.conversation.findUniqueOrThrow({ where: { id: c.id } });
      assert.equal(
        await sendReply(
          {
            id: uncertain,
            confirm: true,
            expectedUpdatedAt: c.updatedAt.toISOString(),
          },
          employee.id,
          {
            send: async () => {
              throw new DeliveryError("UNKNOWN");
            },
          },
        ),
        "UNKNOWN",
      );
      await assert.rejects(
        sendReply(
          {
            id: uncertain,
            confirm: true,
            expectedUpdatedAt: c.updatedAt.toISOString(),
          },
          employee.id,
          adapter,
        ),
      );
      assert.equal(await dispatchNotification(), "NOTIFICATIONS_DISABLED");
      process.env.INBOX_NOTIFICATIONS_ENABLED = "true";
      process.env.INBOX_EMAIL_NOTIFICATIONS_VERIFIED = "true";
      process.env.INBOX_NOTIFICATION_FROM = "alerts@example.com";
      process.env.RESEND_API_KEY = "synthetic";
      global.fetch = async (_url, init) => {
        const body = String(init?.body);
        assert.ok(body.includes("Sign in to review"));
        assert.ok(!body.includes("What days"));
        return Response.json({ id: randomUUID() });
      };
      assert.equal(await dispatchNotification(), "NOTIFICATION_ACCEPTED");
      process.env.INBOX_SMS_NOTIFICATIONS_VERIFIED = "true";
      process.env.INBOX_NOTIFICATION_SMS_FROM = sender.phone;
      global.fetch = async (_url, init) => {
        const body = new URLSearchParams(String(init?.body));
        assert.equal(body.get("To"), "+12025550112");
        assert.ok(body.get("Body")?.includes("Reply STOP"));
        return Response.json({ sid: "SM" + "e".repeat(32) });
      };
      assert.equal(await dispatchNotification(), "NOTIFICATION_ACCEPTED");
      await saveKnowledge(
        {
          campaignId: campaign.id,
          question: "When are estimates available?",
          answer: "An employee will confirm an available time.",
        },
        employee.id,
      );
      await assert.rejects(suggestReply({ id: c.id }, employee.id));
      process.env.INBOX_AI_ENABLED = "true";
      process.env.OPENAI_API_KEY = "synthetic";
      process.env.INBOX_AI_MODEL = "synthetic-model";
      global.fetch = async (url, init) => {
        assert.equal(String(url), "https://api.openai.com/v1/chat/completions");
        const body = JSON.parse(String(init?.body));
        assert.equal(body.store, false);
        assert.equal(body.tools, undefined);
        assert.ok(body.messages[1].content.includes("employee will confirm"));
        return Response.json({
          choices: [
            {
              message: {
                content:
                  "Our team can confirm an available time for your estimate.",
              },
            },
          ],
        });
      };
      await setAiSession(session.tokenHash, employee.id, true);
      const ai = await suggestReply(
        { id: c.id },
        employee.id,
        session.tokenHash,
      );
      assert.ok("draftId" in ai);
      assert.equal(sent.length, 2);
      const stopSid = "SM" + "d".repeat(32);
      receiptKeys.push(`twilio:${stopSid}`);
      await receiveSms(
        new URLSearchParams({
          From: contact.normalizedValue,
          To: sender.phone,
          MessageSid: stopSid,
          Body: "STOP",
          OptOutType: "STOP",
        }),
      );
      assert.equal(
        await db.suppression.count({
          where: {
            customerId: customer.id,
            value: contact.normalizedValue,
            reason: "OPT_OUT",
          },
        }),
        1,
      );
      c = await db.conversation.findUniqueOrThrow({ where: { id: c.id } });
      const stopped = await saveReply(
        {
          conversationId: c.id,
          requestId: randomUUID(),
          body: "Not allowed to send this",
        },
        employee.id,
      );
      await assert.rejects(
        sendReply(
          {
            id: stopped,
            confirm: true,
            expectedUpdatedAt: c.updatedAt.toISOString(),
          },
          employee.id,
          adapter,
        ),
      );
      await updateConversation(
        {
          id: c.id,
          assignedTo: employee.id,
          status: "CLOSED",
          expectedUpdatedAt: c.updatedAt.toISOString(),
        },
        employee.id,
      );
      assert.equal(
        (await db.conversation.findUniqueOrThrow({ where: { id: c.id } }))
          .campaignHold,
        true,
      );
      // Email receipt matching requires both token and original contact address.
      const ec = await db.contact.create({
        data: {
          leadId: lead.id,
          type: "EMAIL",
          value: "lead@example.com",
          normalizedValue: "lead@example.com",
        },
      });
      const emailConversation = await db.conversation.create({
        data: {
          campaignId: campaign.id,
          leadId: lead.id,
          contactId: ec.id,
          channel: "EMAIL",
        },
      });
      process.env.INBOX_EMAIL_DOMAIN = "reply.example.com";
      const emailId = randomUUID();
      receiptKeys.push(`resend:${emailId}`);
      global.fetch = async () =>
        Response.json({
          from: "lead@example.com",
          to: [`reply+${emailConversation.replyToken}@reply.example.com`],
          text: "Email reply",
        });
      await receiveEmail({ data: { email_id: emailId } });
      await receiveEmail({ data: { email_id: emailId } });
      assert.equal(
        await db.message.count({
          where: { conversationId: emailConversation.id, direction: "INBOUND" },
        }),
        1,
      );
      // Exact sender is supplied to Twilio, rather than relying on its pool selection.
      global.fetch = async (_url, init) => {
        const body = new URLSearchParams(String(init?.body));
        assert.equal(body.get("From"), sender.phone);
        assert.equal(body.get("MessagingServiceSid"), "MGtest");
        return Response.json({ sid: "SM" + "f".repeat(32) });
      };
      await deliveryAdapter.send({ ...sent[0], smsFrom: sender.phone });
    } finally {
      global.fetch = originalFetch;
      const bs = await db.outboundBatch.findMany({
        where: { campaign: { customerId: { in: customers } } },
        select: { id: true },
      });
      const rs = await db.outboundRecipient.findMany({
        where: { batchId: { in: bs.map((b) => b.id) } },
        select: { id: true },
      });
      await db.outboundReservation.deleteMany({
        where: { recipientId: { in: rs.map((r) => r.id) } },
      });
      await db.outboundRecipient.deleteMany({
        where: { id: { in: rs.map((r) => r.id) } },
      });
      await db.outboundBatch.deleteMany({
        where: { id: { in: bs.map((b) => b.id) } },
      });
      await db.inboxReceipt.deleteMany({ where: { key: { in: receiptKeys } } });
      await db.customer.deleteMany({ where: { id: { in: customers } } });
      await db.smsSender.deleteMany({
        where: { customerId: { in: customers } },
      });
      await db.employee.deleteMany({ where: { id: { in: employees } } });
      process.env = original;
      await db.$disconnect();
    }
  },
);
