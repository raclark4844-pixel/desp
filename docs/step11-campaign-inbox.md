# Campaign inbox and exact SMS sender selection

Employees open `/inbox` from Operations or Campaign sending. All active employees can read conversations, assign handoffs, draft and send reviewed replies. Administrators manage campaign senders, notification destinations and approved business answers. Every write requires an employee session and same-origin request. Existing sending and contact compliance gates apply to manual replies as well as campaign batches.

## Campaign sender

In Inbox → Campaign settings, select a campaign, verify an existing Twilio SMS number, then assign it. The number must already belong to the configured Messaging Service. The administrator confirms carrier registration and seller authorization; ownership verification does not independently verify A2P approval. Numbers are bound to one customer. Approval snapshots the exact number into the batch; subsequent sends include both `From` and `MessagingServiceSid`. The assignment cannot change after SMS batch approval. Drafts may be prepared without a number; approval cannot proceed without one. Existing approved SMS batches without a sender fail closed and must be replaced rather than silently falling back.

No numbers are purchased automatically. The existing single-seller `OUTREACH_CUSTOMER_ID` restriction remains. Reusing one owned number across campaigns in a region is supported. If the same phone pair is associated with more than one conversation, the incoming message is quarantined rather than assigned by guesswork.

## Incoming messages and reply behavior

Existing signed Twilio webhook: `/api/outreach/twilio?action=inbound`. Both sender and receiving number must match. Provider receipt keys deduplicate retries. Conversations are created before the outgoing provider call, so fast replies can be attributed. A reply holds future campaign automation for that lead. Closing/assigning a conversation does not clear that hold. STOP suppresses the phone for the customer, even when a known sender number has an unmatched incoming message. START never clears suppression.

Email receiving uses the existing signed Resend webhook `/api/outreach/resend` subscribed to `email.received`. Enable a dedicated receiving subdomain and set `INBOX_EMAIL_DOMAIN`. Outgoing email uses an unguessable `reply+<conversation-token>@<subdomain>` Reply-To. The token and original contact email must both match. Retrieved plain text is displayed as text; HTML, attachments and links are not executed or downloaded. A signed provider event authenticates the event, not the human sender, so incoming email never grants consent or triggers an autonomous action. Unmatched/ambiguous messages appear in a separate review list and cannot be replied to through this release.

The inbox polls every 20 seconds, lists conversations in pages of 50, and shows the latest 200 messages and 50 reply drafts per conversation. Employee-reviewed replies persist a SENDING record before calling a provider. UNKNOWN/SENDING results cannot be resubmitted and block further replies pending provider review. There are no automatic retries of manual replies. Delivery callbacks update the reply and message. A new inbound message during sending remains marked as needing a reply. Existing consent, suppression, seller binding, sending hours, verified setup and master/channel switches all apply. Existing legacy INTERNAL suppressions remain blocked for manual review.

## Multiple employee notifications

Administrators add up to 25 employee/channel destinations per campaign. Email must match the employee account; SMS requires confirmed employee ownership and permission. The administrator can disable a target; STOP disables SMS alerts for that destination. After a signed webhook completes, up to three notifications are dispatched in the background. The existing five-minute outreach worker processes additional pending alerts one at a time, so larger lists may be delayed. Alerts contain only a sign-in link, not message bodies or personal details. Status SENT means provider accepted, not guaranteed delivery. Uncertain delivery is UNKNOWN and is never blindly retried.

Required before activating alerts:
- `INBOX_NOTIFICATIONS_ENABLED=true` in production only.
- Email: `RESEND_API_KEY`, verified `INBOX_NOTIFICATION_FROM`, `INBOX_EMAIL_NOTIFICATIONS_VERIFIED=true`.
- SMS: Twilio credentials, registered `INBOX_NOTIFICATION_SMS_FROM`, `INBOX_SMS_NOTIFICATIONS_VERIFIED=true`. Configure that number's incoming webhook to the same Twilio inbound endpoint for STOP handling.
- Existing `OUTREACH_PUBLIC_URL`, `CRON_SECRET`.

Notification enablement is separate from prospect outreach. All new switches default off; no recipient is invented and no live alert is sent during deployment. Pending notifications should be reviewed before enabling a channel.

## OpenAI draft assistant

Set `OPENAI_API_KEY` as a production secret, `INBOX_AI_MODEL` to the approved API model ID and `INBOX_AI_ENABLED=true` only after choosing data-sharing and spending settings. A ChatGPT subscription does not supply API credentials. The user explicitly chose OpenAI for later setup.

An employee can request a suggestion manually or opt into session monitoring as described below. OpenAI receives up to 20 recent messages and 30 campaign-specific, administrator-approved answers. Email/phone patterns are redacted, but other personal data may remain in message text; this is not full anonymization. `store:false` is used; provider retention terms still apply. No tools, browsing, credential access, sending or database mutation capabilities are given to the model. Incoming content is untrusted data. Drafts are limited to channel length and stored for human review; safety/escalation suggestions are displayed as internal notes. Requests are limited to one per minute per employee. A system prompt is not a security boundary: the hard boundary is that the model can only return text and cannot send it.

“Learning” here means using approved answer examples, not automatic fine-tuning. Administrators approve/retire knowledge. Automatic prospect replies, autonomous calls, self-training and removal of human oversight are deliberately not implemented. Those require a separately reviewed operating policy, escalation rules, evaluation set, spending limits and explicit activation.

## Validation

Run unit tests, isolated inbox/outreach integration tests, Prisma validate and production build. Never use production customer data for tests, and never invoke real delivery adapters during tests. Migration is additive and backfills random reply tokens for existing conversations. Old conversations without known sender numbers are not guessed into an inbound match.

## Session AI monitoring and interested-lead handoff

Each employee login starts with AI off. The first private page offers a session-only opt-in, an unchecked confirmation box, and Continue without AI. Employees can stop or reopen AI session settings at any time. Consent is stored against the hashed login session with an incrementing version; expiry, logout, account disablement and revocation block monitoring. No provider request occurs without the configured OpenAI switch/key/model. The popup discloses processing of recent message history and possible personal information. It does not authorize model training or automatic sending.

While an opted-in workspace tab is visible, it checks once per minute for new SMS/email messages created after consent. One message is claimed globally, with unique message IDs, bounded context, a workspace monitor limit of one request per minute and 100 requests per UTC day. Drafts and summaries are persisted only after a fresh session/version check. Failed or interrupted work requires employee review rather than an automatic retry. Newer messages prevent stale monitored replies from becoming drafts. Provider suggestions cannot send or invoke tools. Monitoring does not cover external apps, microphones, or unrecorded calls. Manual AI draft requests also require session permission.

AI may propose reusable business answers from employee messages. These remain unapproved until an administrator explicitly verifies and approves them. Approved answers can be retired in Campaign settings. This is curated knowledge reuse, not model fine-tuning; names and other personal information must be removed before approval.

In Inbox → Campaign settings, save the campaign's main customer/company contact name and mobile number, confirming permission to receive qualified lead details. This is separate from AP Spartan employee reply alerts. Existing employee assignments are not converted to customer recipients automatically.

In a conversation, expand “Send qualified lead to campaign contact.” Prospect name, property address, phone and email fill from the lead database; service fills from a recorded qualification answer when available. Missing data stays blank. Employees review/edit these fields, complete required fields (email is optional), and confirm the prospect wants the service and agreed to share these details with that customer. The generated SMS contains the campaign name and the reviewed fields. It does not require the recipient to have an employee login.

The customer destination is snapshotted; changing or disabling the campaign contact cancels pending deliveries instead of rerouting them. Duplicate submissions for the same campaign/lead reuse the first delivery, including unknown delivery states. The conversation becomes Qualified and stays on campaign automation hold; employee assignment is unchanged. Generic reply alerts are sent only to employee notification targets, never automatically to customer lead recipients. Customer recipient STOP disables further texts to that number. Legacy employee-handoff jobs are cancelled by the updated worker.

Lead delivery uses the existing notification switches and verified SMS sender. With texting disabled the button saves a pending lead delivery and clearly says texting is off. Pending means queued, not sent; SENT means provider accepted. SMS may span multiple segments. No live texts are sent by testing or deployment. AI session behavior is unchanged, and autonomous replies remain unavailable.
