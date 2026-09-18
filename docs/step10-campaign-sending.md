# Campaign sending: disabled until setup is verified

Employees can prepare messages at `/sending`; administrators approve, pause, resume and cancel batches. Creating campaigns, importing leads and saving drafts never sends anything. Approval freezes the message and snapshots at most 5,000 enrolled contacts (one contact per lead per channel; duplicate destinations removed). Stale review screens cannot approve a changed draft.

Approved campaigns run serially. For the earliest queued campaign, approved channels run SMS → EMAIL → CALL. Approve all desired channels before enabling delivery; a later-approved channel cannot undo earlier deliveries. Paused/review batches hold the queue. A worker dispatches at most one recipient per invocation (the existing Vercel project uses a five-minute schedule). It waits for provider delivery callbacks before advancing, with at least 24 hours between channels for the same lead. This deliberately conservative first release is not a high-volume sender.

## Providers and manual setup

This release supports one configured customer/seller at a time, identified by `OUTREACH_CUSTOMER_ID`. Other customers remain blocked. Do not reuse another customer's verified sender, registration, or consent.

Common Vercel production environment configuration:

- `OUTREACH_PUBLIC_URL=https://desp-omega.vercel.app` (no trailing slash)
- `OUTREACH_CUSTOMER_ID`: the customer whose sender identities and registration have been verified
- `OUTREACH_ENABLED=false` and `OUTREACH_SMS_ENABLED=false`, `OUTREACH_EMAIL_ENABLED=false`, `OUTREACH_CALL_ENABLED=false` while setup/testing remains incomplete
- The existing `CRON_SECRET` protects scheduled workers. Preview/local environments cannot deliver through the worker.

SMS / Twilio:

- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_MESSAGING_SERVICE_SID`
- Complete the appropriate US sender registration (A2P 10DLC or toll-free verification), configure Advanced Opt-Out, and point the incoming-message POST webhook to `/api/outreach/twilio?action=inbound` on the public URL. Delivery callbacks are supplied with each API request.
- `FTC_SAN`, `FTC_ORGANIZATION_ID`, `FTC_SAN_EXPIRES_AT` (ISO timestamp) for this seller. This conservative implementation requires valid registration for both phone channels. Per-recipient DNC evidence still must cover the target area codes; possession of a SAN alone is not clearance.
- Verify webhook signatures, STOP handling, registration scope and sender identity before setting `OUTREACH_SMS_SETUP_VERIFIED=true`.

Email / Resend:

- `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `OUTREACH_FROM_EMAIL`, `OUTREACH_REPLY_TO`
- Verify the customer's sending domain; configure SPF, DKIM and DMARC and a monitored reply mailbox.
- Register `/api/outreach/resend` for delivered, bounced, complained, failed and suppressed email events. Copy its signing secret into Vercel.
- Every email includes the batch's physical mailing address, advertisement disclosure, sender identification and a persistent unsubscribe link. GET shows a confirmation; POST immediately suppresses the recipient. List-Unsubscribe / one-click headers are included.
- Verify the domain, address, unsubscribe flow and webhook delivery before setting `OUTREACH_EMAIL_SETUP_VERIFIED=true`.
- This release does not ingest ordinary email replies. Staff must monitor the reply mailbox and record requests/opt-outs promptly through the review workspace. Imported data alone does not supply consent.

Calls / Twilio:

- Reuse the Twilio account credentials; configure `TWILIO_VOICE_FROM` and `OUTREACH_AGENT_PHONE` in E.164 format.
- Calls are employee-assisted, not prerecorded prospect calls or AI voice calls. Twilio rings the designated employee first. Pressing 1 performs another eligibility check and bridges one prospect. The employee reads the approved script shown in the workspace. No call recording is enabled.
- The employee must be available, identify the correct seller, and record opt-outs immediately in compliance review. Verify caller ID, inbound callback handling on the business number, and the signed bridge/result callbacks before setting `OUTREACH_CALL_SETUP_VERIFIED=true`.

Only after real provider tests and a campaign/channel compliance review should an authorized operator set the relevant channel switch and global switch to `true`. Deploy/redeploy to apply environment changes. This implementation did not enable those switches, buy provider service, or contact prospects.

## Controls and limits

Fresh dispatch checks reuse the existing consent, ownership, jurisdiction, DNC/reassignment or deliverability evidence, enrollment, campaign dates/status, customer status and suppressions. Policy readiness is not a legal authorization token. The queue adds administrator approval, provider setup, seller binding, current FTC registration for phone channels, local sending windows, recipient spacing and lifetime customer/channel/destination deduplication.

The administrator must verify all recipients share the selected timezone and that the configured weekday 10 AM–6 PM window is appropriate for the jurisdiction. Split mixed-timezone audiences before approval. The app does not infer timezone from a phone area code or implement every state-specific rule.

Outbound reservations and SENDING state commit before the API request. Overlapping workers cannot double-dispatch. Only definite HTTP 429 rejections retry (bounded to three attempts with backoff and fresh checks). Network errors, 5xx, malformed success responses, database errors after acceptance, or expired leases become UNKNOWN and hold the queue; there is no blind retry. An operator can cancel/abandon that batch, but the deduplication reservation remains. Late delivery webhooks can reconcile UNKNOWN rows. Cancellation cannot recall an in-flight provider request. Repeated Twilio bridge requests never dial twice.

Provider acceptance is distinct from delivery. Email/text callbacks update Message records and recipient status; phone completion records a completed call, not a sale or qualification. Delivery failure stops the batch. Twenty-four hours without delivery confirmation requires review. SMS replies are held for a human; STOP, email unsubscribe, bounces and complaints create persistent suppressions for the destination and matching leads. START never silently reactivates a suppressed recipient.

Authenticated employee routes enforce same-origin mutation checks. Only active administrators can approve/control batches. Webhooks verify signatures, account/recipient binding and monotonic delivery transitions. Resend signatures expire after five minutes; duplicate events are harmless. Unsubscribe links use random bearer tokens and require no employee login. Audit events retain identifiers/status/reasons without raw destinations or message content.

## Validation

Prisma migration is additive and tested in an isolated Neon database. Synthetic tests use fake delivery adapters and signed fake webhook payloads. They cover disabled gates, fresh evidence, ordered channels, concurrent workers, stale approvals, approval immutability, spacing, unsubscribe suppression, callback replay, unknown outcomes, and one-time employee phone bridging. No live vendor traffic is needed for these tests. Provider-account end-to-end verification remains a required setup step before live enablement.

References: [Twilio messaging](https://www.twilio.com/docs/messaging/api/message-resource), [Twilio webhook security](https://www.twilio.com/docs/usage/security), [Twilio Dial](https://www.twilio.com/docs/voice/twiml/dial), [Resend email API](https://resend.com/docs/api-reference/emails/send-email), [Resend webhook verification](https://resend.com/docs/webhooks/verify-webhooks-requests).
