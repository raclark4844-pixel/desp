import { z } from "zod";
import { createHash } from "node:crypto";
export const channels = ["SMS", "EMAIL", "CALL"] as const;
export type SendChannel = (typeof channels)[number];
export const draftSchema = z
  .object({
    campaignId: z.string().uuid(),
    channel: z.enum(channels),
    subject: z.string().trim().max(160).default(""),
    body: z.string().trim().min(10).max(4000),
    mailingAddress: z.string().trim().min(10).max(300),
    recipientTimezone: z.string().refine((value) => {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: value });
        return true;
      } catch {
        return false;
      }
    }),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.channel === "SMS" && v.body.length > 600)
      ctx.addIssue({
        code: "custom",
        message: "Text messages must be 600 characters or less.",
      });
    if (v.channel === "EMAIL" && !v.subject)
      ctx.addIssue({ code: "custom", message: "Email subject is required." });
  });
export const controlSchema = z
  .object({
    id: z.string().uuid(),
    action: z.enum(["APPROVE", "PAUSE", "RESUME", "CANCEL"]),
    confirmReview: z.boolean().optional(),
    expectedUpdatedAt: z.iso.datetime().optional(),
  })
  .strict();
export function sendingWindow(timezone: string, now = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
      hour: "numeric",
      hourCycle: "h23",
    }).formatToParts(now);
    const hour = Number(parts.find((p) => p.type === "hour")?.value);
    const day = parts.find((p) => p.type === "weekday")?.value;
    return day !== "Sat" && day !== "Sun" && hour >= 10 && hour < 18;
  } catch {
    return false;
  }
}
export function reservationKey(
  customerId: string,
  channel: SendChannel,
  destination: string,
) {
  return createHash("sha256")
    .update(`${customerId}:${channel}:${destination}`)
    .digest("hex");
}
export function setupReasons(
  channel: SendChannel,
  customerId: string,
  env: Partial<NodeJS.ProcessEnv> = process.env,
) {
  const reasons: string[] = [];
  if (env.VERCEL_ENV !== "production")
    reasons.push("PRODUCTION_DEPLOYMENT_REQUIRED");
  if (env.OUTREACH_ENABLED !== "true") reasons.push("LIVE_SENDING_DISABLED");
  if (env[`OUTREACH_${channel}_ENABLED`] !== "true")
    reasons.push(`${channel}_DISABLED`);
  if (env.OUTREACH_CUSTOMER_ID !== customerId)
    reasons.push("SENDER_CUSTOMER_NOT_CONFIGURED");
  if (
    !env.OUTREACH_PUBLIC_URL ||
    !/^https:\/\/[^/]+$/.test(env.OUTREACH_PUBLIC_URL)
  )
    reasons.push("PUBLIC_CALLBACK_URL_REQUIRED");
  if (env[`OUTREACH_${channel}_SETUP_VERIFIED`] !== "true")
    reasons.push("PROVIDER_SETUP_NOT_VERIFIED");
  const required =
    channel === "EMAIL"
      ? [
          "RESEND_API_KEY",
          "RESEND_WEBHOOK_SECRET",
          "OUTREACH_FROM_EMAIL",
          "OUTREACH_REPLY_TO",
        ]
      : [
          "TWILIO_ACCOUNT_SID",
          "TWILIO_AUTH_TOKEN",
          ...(channel === "SMS"
            ? ["TWILIO_MESSAGING_SERVICE_SID"]
            : ["TWILIO_VOICE_FROM", "OUTREACH_AGENT_PHONE"]),
        ];
  if (channel !== "EMAIL") {
    required.push("FTC_SAN", "FTC_ORGANIZATION_ID", "FTC_SAN_EXPIRES_AT");
    const expiry = Date.parse(env.FTC_SAN_EXPIRES_AT ?? "");
    if (!Number.isFinite(expiry) || expiry <= Date.now())
      reasons.push("FTC_REGISTRATION_MISSING_OR_EXPIRED");
  }
  for (const key of required) if (!env[key]) reasons.push(`${key}_REQUIRED`);
  return reasons;
}
export const xmlEscape = (s: string) =>
  s.replace(
    /[<>&"']/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
