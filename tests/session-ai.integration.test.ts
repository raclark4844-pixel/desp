import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../src/lib/db";
import { newSession } from "../src/lib/employee/auth";
import {
  aiSessionView,
  setAiSession,
  requireAiSession,
} from "../src/lib/inbox/ai-session";
import { monitorSession, approveObservation } from "../src/lib/inbox/monitor";
import {
  setPrimaryContact,
  queueHandoff,
  handoffPreview,
} from "../src/lib/inbox/handoff";
import { dispatchNotification } from "../src/lib/inbox/notifications";
import { GET, POST } from "../src/app/api/employee/ai-session/route";

test(
  "session permission, monitored drafts, revocation and customer lead delivery",
  { skip: process.env.APS_ISOLATED_TEST_DB !== "true" },
  async () => {
    const env = { ...process.env },
      originalFetch = global.fetch;
    let customerId = "",
      employeeId = "";
    try {
      global.fetch = async () => {
        throw new Error("Unexpected external request");
      };
      process.env.INBOX_AI_ENABLED = "false";
      process.env.INBOX_NOTIFICATIONS_ENABLED = "false";
      const customer = await db.customer.create({
        data: { name: "Synthetic Session AI", slug: randomUUID() },
      });
      customerId = customer.id;
      const employee = await db.employee.create({
        data: {
          name: "Synthetic Employee",
          username: randomUUID(),
          email: `${randomUUID()}@example.com`,
          passwordHash: "unused",
          mustChangePassword: false,
        },
      });
      employeeId = employee.id;
      const session = newSession(),
        second = newSession();
      for (const s of [session, second])
        await db.employeeSession.create({
          data: { tokenHash: s.tokenHash, employeeId, expiresAt: s.expiresAt },
        });
      assert.equal(
        (await aiSessionView(session.tokenHash, employeeId)).decided,
        false,
      );
      await assert.rejects(requireAiSession(session.tokenHash, employeeId));
      await setAiSession(session.tokenHash, employeeId, true);
      await assert.rejects(requireAiSession(second.tokenHash, employeeId));
      assert.equal(
        (await monitorSession(session.tokenHash, employeeId)).status,
        "NOT_CONFIGURED",
      );
      assert.equal(
        (await GET(new Request("https://test.example/api/employee/ai-session")))
          .status,
        401,
      );
      assert.equal(
        (
          await POST(
            new Request("https://test.example/api/employee/ai-session", {
              method: "POST",
              headers: {
                cookie: `ap_employee=${session.token}`,
                origin: "https://evil.example",
              },
            }),
          )
        ).status,
        403,
      );
      const campaign = await db.campaign.create({
        data: { customerId, name: "Synthetic Campaign", industry: "roofing" },
      });
      const lead = await db.lead.create({
        data: {
          customerId,
          firstName: "Sam",
          lastName: "Prospect",
          properties: {
            create: {
              address1: "123 Test Street",
              city: "Example",
              state: "DC",
              postalCode: "20001",
            },
          },
          contacts: {
            create: {
              type: "MOBILE",
              value: "+12025550118",
              normalizedValue: "+12025550118",
            },
          },
        },
        include: { contacts: true },
      });
      const contact = lead.contacts[0];
      const conversation = await db.conversation.create({
        data: {
          campaignId: campaign.id,
          leadId: lead.id,
          contactId: contact.id,
          channel: "SMS",
        },
      });
      const message = await db.message.create({
        data: {
          conversationId: conversation.id,
          contactId: contact.id,
          direction: "INBOUND",
          status: "RECEIVED",
          body: "Yes, I want to proceed.",
        },
      });
      await setPrimaryContact(
        {
          campaignId: campaign.id,
          name: "Customer Main Contact",
          phone: "+12025550119",
          confirm: true,
        },
        employeeId,
      );
      const target = await db.notificationTarget.findFirstOrThrow({
        where: { campaignId: campaign.id, kind: "CUSTOMER" },
      });
      assert.equal(target.employeeId, null);
      const preview = await handoffPreview(conversation.id);
      assert.equal(preview.fields.name, "Sam Prospect");
      assert.match(preview.fields.address, /123 Test Street/);
      assert.equal(preview.fields.phone, contact.normalizedValue);
      assert.equal(preview.fields.email, "");
      assert.equal(preview.fields.service, "");
      const handoff = {
        conversationId: conversation.id,
        targetId: target.id,
        sourceMessageId: message.id,
        expectedPhone: target.destination,
        fields: { ...preview.fields, service: "Roof replacement" },
        confirm: true,
      };
      await assert.rejects(
        queueHandoff({ ...handoff, expectedPhone: "+12025550120" }, employeeId),
      );
      await assert.rejects(
        queueHandoff({ ...handoff, confirm: false }, employeeId),
      );
      const alert = await queueHandoff(handoff, employeeId);
      assert.equal(alert.status, "PENDING");
      assert.equal((await queueHandoff(handoff, employeeId)).id, alert.id);
      assert.equal(await dispatchNotification(), "NOTIFICATIONS_DISABLED");
      const assigned = await db.conversation.findUniqueOrThrow({
        where: { id: conversation.id },
      });
      assert.equal(assigned.assignedTo, null);
      assert.equal(assigned.status, "QUALIFIED");
      assert.equal(assigned.campaignHold, true);
      Object.assign(process.env, {
        VERCEL_ENV: "production",
        INBOX_NOTIFICATIONS_ENABLED: "true",
        INBOX_SMS_NOTIFICATIONS_VERIFIED: "true",
        TWILIO_ACCOUNT_SID: "ACsynthetic",
        TWILIO_AUTH_TOKEN: "synthetic",
        INBOX_NOTIFICATION_SMS_FROM: "+12025550999",
        OUTREACH_PUBLIC_URL: "https://test.example",
      });
      let deliveries = 0;
      global.fetch = async (url, init) => {
        deliveries++;
        assert.match(String(url), /api.twilio.com/);
        const body = new URLSearchParams(String(init?.body));
        assert.equal(body.get("To"), target.destination);
        assert.notEqual(body.get("To"), contact.normalizedValue);
        assert.match(body.get("Body")!, /Name: Sam Prospect/);
        assert.match(body.get("Body")!, /Service requested: Roof replacement/);
        assert.match(body.get("Body")!, /Email: Not provided/);
        return Response.json({ sid: "SMsyntheticcustomerhandoff" });
      };
      assert.equal(await dispatchNotification(), "NOTIFICATION_ACCEPTED");
      assert.equal(deliveries, 1);
      assert.equal((await queueHandoff(handoff, employeeId)).status, "SENT");
      assert.equal(await dispatchNotification(), "NO_NOTIFICATION_READY");
      process.env.INBOX_NOTIFICATIONS_ENABLED = "false";
      Object.assign(process.env, {
        INBOX_AI_ENABLED: "true",
        OPENAI_API_KEY: "synthetic",
        INBOX_AI_MODEL: "synthetic-model",
      });
      let calls = 0;
      global.fetch = async (_url, init) => {
        calls++;
        const b = JSON.parse(String(init?.body));
        assert.equal(b.store, false);
        assert.equal(b.tools, undefined);
        return Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: "The person wants to proceed.",
                  reply: "An employee will follow up shortly.",
                  question: "",
                  answer: "",
                }),
              },
            },
          ],
        });
      };
      assert.equal(
        (await monitorSession(session.tokenHash, employeeId)).status,
        "COMPLETE",
      );
      assert.equal(calls, 1);
      assert.equal(
        await db.inboxReply.count({
          where: { conversationId: conversation.id },
        }),
        1,
      );
      assert.equal(
        await db.message.count({
          where: { conversationId: conversation.id, direction: "OUTBOUND" },
        }),
        0,
      );
      await monitorSession(session.tokenHash, employeeId);
      assert.equal(calls, 1);
      const observation = await db.aiObservation.findUniqueOrThrow({
        where: { messageId: message.id },
      });
      await assert.rejects(
        approveObservation({ id: observation.id, confirm: true }, employeeId),
      );
      // Only an administrator's reviewed suggestion becomes reusable knowledge.
      await db.aiObservation.update({
        where: { id: observation.id },
        data: {
          question: "Who confirms appointments?",
          answer: "An employee confirms appointments.",
        },
      });
      await approveObservation(
        { id: observation.id, confirm: true },
        employeeId,
      );
      await approveObservation(
        { id: observation.id, confirm: true },
        employeeId,
      );
      assert.equal(
        await db.replyKnowledge.count({ where: { campaignId: campaign.id } }),
        1,
      );
      // Revoking during a provider call must prevent publishing its response.
      await db.auditEvent.updateMany({
        where: {
          actorId: employeeId,
          eventType: "outreach.ai_monitor_requested",
        },
        data: { createdAt: new Date(Date.now() - 120000) },
      });
      await db.message.create({
        data: {
          conversationId: conversation.id,
          contactId: contact.id,
          direction: "INBOUND",
          status: "RECEIVED",
          body: "When can I speak with someone?",
        },
      });
      global.fetch = async () => {
        await setAiSession(session.tokenHash, employeeId, false);
        return Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: "New question",
                  reply: "This must not be published.",
                  question: "",
                  answer: "",
                }),
              },
            },
          ],
        });
      };
      assert.equal(
        (await monitorSession(session.tokenHash, employeeId)).status,
        "REVIEW",
      );
      assert.equal(
        await db.inboxReply.count({
          where: { conversationId: conversation.id },
        }),
        1,
      );
      await assert.rejects(monitorSession(session.tokenHash, employeeId));
      await setAiSession(session.tokenHash, employeeId, true);
      await db.employeeSession.update({
        where: { tokenHash: session.tokenHash },
        data: { expiresAt: new Date(0) },
      });
      await assert.rejects(requireAiSession(session.tokenHash, employeeId));
      assert.equal(
        (await aiSessionView(second.tokenHash, employeeId)).enabled,
        false,
      );
    } finally {
      global.fetch = originalFetch;
      process.env = env;
      if (employeeId) {
        await db.aiObservation.deleteMany({ where: { employeeId } });
        await db.auditEvent.deleteMany({ where: { actorId: employeeId } });
      }
      if (customerId) await db.customer.delete({ where: { id: customerId } });
      if (employeeId) await db.employee.delete({ where: { id: employeeId } });
      await db.$disconnect();
    }
  },
);
