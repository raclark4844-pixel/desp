import type { SendChannel } from "./policy";
export type DeliveryInput = {
  id: string;
  smsFrom?: string;
  replyToken?: string;
  inboxReply?: boolean;
  channel: SendChannel;
  destination: string;
  body: string;
  subject: string;
  senderName: string;
  mailingAddress: string;
  unsubscribeToken: string;
};
export class DeliveryError extends Error {
  constructor(public kind: "REJECTED" | "UNKNOWN" | "RATE_LIMITED") {
    super(kind);
  }
}
export interface DeliveryAdapter {
  send(input: DeliveryInput): Promise<string>;
}
export const deliveryAdapter: DeliveryAdapter = {
  async send(input) {
    const env = process.env;
    const base = env.OUTREACH_PUBLIC_URL!;
    let response: Response;
    try {
      if (input.channel === "EMAIL") {
        const unsubscribe = `${base}/api/outreach/unsubscribe?token=${input.unsubscribeToken}`;
        response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          signal: AbortSignal.timeout(15000),
          headers: {
            Authorization: `Bearer ${env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
            "Idempotency-Key": `outbound-${input.id}`,
          },
          body: JSON.stringify({
            from: env.OUTREACH_FROM_EMAIL,
            reply_to:
              input.replyToken && env.INBOX_EMAIL_DOMAIN
                ? `reply+${input.replyToken}@${env.INBOX_EMAIL_DOMAIN}`
                : env.OUTREACH_REPLY_TO,
            to: [input.destination],
            subject: input.subject,
            text: `${input.senderName}\n\n${input.body}\n\nAdvertisement from ${input.senderName}\n${input.mailingAddress}\nUnsubscribe: ${unsubscribe}`,
            headers: {
              "List-Unsubscribe": `<${unsubscribe}>`,
              "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
            },
          }),
        });
      } else {
        const callback = `${base}/api/outreach/twilio?${input.inboxReply ? "reply" : "id"}=${input.id}&action=status`;
        const fields: Record<string, string> =
          input.channel === "SMS"
            ? {
                To: input.destination,
                ...(input.smsFrom ? { From: input.smsFrom } : {}),
                MessagingServiceSid: env.TWILIO_MESSAGING_SERVICE_SID!,
                Body: `${input.senderName}: ${input.body}\nReply STOP to opt out.`,
                StatusCallback: callback,
                ValidityPeriod: "300",
              }
            : {
                To: env.OUTREACH_AGENT_PHONE!,
                From: env.TWILIO_VOICE_FROM!,
                Url: `${base}/api/outreach/twilio?id=${input.id}&action=voice`,
                StatusCallback: callback,
                StatusCallbackEvent: "completed",
                Timeout: "20",
              };
        response = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/${input.channel === "SMS" ? "Messages" : "Calls"}.json`,
          {
            method: "POST",
            signal: AbortSignal.timeout(15000),
            headers: {
              Authorization: `Basic ${Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString("base64")}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams(fields),
          },
        );
      }
    } catch {
      throw new DeliveryError("UNKNOWN");
    }
    if (response.status === 429) throw new DeliveryError("RATE_LIMITED");
    if (!response.ok)
      throw new DeliveryError(response.status >= 500 ? "UNKNOWN" : "REJECTED");
    try {
      const body = await response.json();
      const id = input.channel === "EMAIL" ? body.id : body.sid;
      if (typeof id !== "string" || !id) throw new Error();
      return id;
    } catch {
      throw new DeliveryError("UNKNOWN");
    }
  },
};
