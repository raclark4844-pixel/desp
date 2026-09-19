import { createHash } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "./db";
import { asRecord } from "./lead-sources/contract";
import { channels, draftSchema, setupReasons } from "./outreach/policy";

const names = {
  SMS: "Text message",
  EMAIL: "Email",
  CALL: "Employee-assisted phone call",
};
function setupLabel(reason: string) {
  const labels: Record<string, string> = {
    LIVE_SENDING_DISABLED: "Live sending is switched off",
    SMS_DISABLED: "Text delivery is switched off",
    EMAIL_DISABLED: "Email delivery is switched off",
    CALL_DISABLED: "Phone delivery is switched off",
    SENDER_CUSTOMER_NOT_CONFIGURED:
      "Sending account must be assigned to this customer",
    PUBLIC_CALLBACK_URL_REQUIRED: "Delivery callbacks must be configured",
    PROVIDER_SETUP_NOT_VERIFIED: "Provider setup has not been verified",
    PRODUCTION_DEPLOYMENT_REQUIRED:
      "Live delivery requires the production site",
    FTC_REGISTRATION_MISSING_OR_EXPIRED:
      "FTC registration is missing or expired",
    SMS_NUMBER_REQUIRED:
      "Assign an approved campaign texting number in the Inbox settings",
  };
  if (labels[reason]) return labels[reason];
  const required: Record<string, string> = {
    RESEND_API_KEY: "Email provider connection",
    RESEND_WEBHOOK_SECRET: "Email delivery reporting",
    OUTREACH_FROM_EMAIL: "Verified sender email",
    OUTREACH_REPLY_TO: "Reply-to email",
    TWILIO_ACCOUNT_SID: "Twilio account",
    TWILIO_AUTH_TOKEN: "Twilio authentication",
    TWILIO_MESSAGING_SERVICE_SID: "Text messaging service",
    TWILIO_VOICE_FROM: "Calling number",
    OUTREACH_AGENT_PHONE: "Employee phone for assisted calls",
    FTC_SAN: "FTC subscription account number",
    FTC_ORGANIZATION_ID: "FTC organization ID",
    FTC_SAN_EXPIRES_AT: "FTC registration expiration",
  };
  return `${required[reason.replace(/_REQUIRED$/, "")] ?? "Provider configuration"} is required`;
}
export async function campaignPreparation(
  campaignId: string,
  client: Prisma.TransactionClient = db,
) {
  const c = await client.campaign.findUnique({
    where: { id: campaignId },
    include: {
      customer: { select: { name: true } },
      smsSender: true,
      territories: { orderBy: { id: "asc" } },
      outboundBatches: { orderBy: { channel: "asc" } },
    },
  });
  if (!c) return null;
  const requested = asRecord(asRecord(c.outreachConfig).requestedChannels);
  const messages = channels
    .filter(
      (ch) =>
        requested[
          ch === "SMS" ? "sms" : ch === "EMAIL" ? "email" : "calling"
        ] === true,
    )
    .map((channel) => {
      const b = c.outboundBatches.find(
        (b) => b.channel === channel && b.status !== "CANCELLED",
      );
      const valid =
        !!b &&
        draftSchema.safeParse({
          campaignId,
          channel,
          subject: b.subject,
          body: b.body,
          mailingAddress: b.mailingAddress,
          recipientTimezone: b.recipientTimezone,
        }).success;
      const reasons = setupReasons(channel, c.customerId);
      if (
        channel === "SMS" &&
        (!c.smsSender?.active ||
          c.smsSender.customerId !== c.customerId ||
          c.smsSender.serviceSid !== process.env.TWILIO_MESSAGING_SERVICE_SID)
      )
        reasons.push("SMS_NUMBER_REQUIRED");
      return {
        channel,
        label: names[channel],
        ready: valid,
        batchId: b?.id ?? null,
        updatedAt: b?.updatedAt.toISOString() ?? null,
        status: b?.status ?? "MISSING",
        subject: b?.subject ?? "",
        preview: !b
          ? "No message saved yet."
          : channel === "SMS"
            ? `${c.customer.name}: ${b.body}\nReply STOP to opt out.`
            : channel === "EMAIL"
              ? `${c.customer.name}\n\n${b.body}\n\nAdvertisement from ${c.customer.name}\n${b.mailingAddress}\nUnsubscribe: [personal unsubscribe link added when sent]`
              : b.body,
        sender:
          channel === "SMS"
            ? (c.smsSender?.phone ?? "Not assigned")
            : channel === "EMAIL"
              ? (process.env.OUTREACH_FROM_EMAIL ?? "Not configured")
              : (process.env.TWILIO_VOICE_FROM ?? "Not configured"),
        replyTo:
          channel === "EMAIL"
            ? (process.env.OUTREACH_REPLY_TO ?? "Not configured")
            : null,
        mailingAddress: b?.mailingAddress ?? "",
        timezone: b?.recipientTimezone ?? "",
        setup: reasons.map(setupLabel),
      };
    });
  const details = {
    campaignId,
    customerId: c.customerId,
    customerName: c.customer.name,
    name: c.name,
    desiredLeadCount: c.desiredLeadCount,
    industry: c.industry,
    territories: c.territories.map((t) =>
      [t.type, t.value, t.state, t.county].filter(Boolean).join(" · "),
    ),
    targeting: c.targetingConfig,
    residential: c.residential,
    commercial: c.commercial,
    messages,
    messagesReady: messages.every((m) => m.ready),
    setupPending: messages.some((m) => m.setup.length > 0),
  };
  return {
    ...details,
    reviewToken: createHash("sha256")
      .update(JSON.stringify(details))
      .digest("hex"),
  };
}
export type CampaignPreparation = NonNullable<
  Awaited<ReturnType<typeof campaignPreparation>>
>;
export function preparationIssue(
  preparation: CampaignPreparation,
  token: string | undefined,
  acknowledgeSetup: boolean,
) {
  if (!preparation.messagesReady)
    return "Save a valid message or call script for every selected channel before collecting leads.";
  if (token !== preparation.reviewToken)
    return "Campaign messages or setup changed. Reload the checklist and confirm the latest details.";
  if (preparation.setupPending && !acknowledgeSetup)
    return "Confirm that unresolved sending setup will be completed before outreach.";
  return null;
}
