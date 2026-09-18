# Step 6: conservative lead-readiness review

This backend adds authenticated evidence recording and fresh, per-contact/channel reviews. It never creates messages, calls, conversations, or outbound jobs, and never changes a lead to ELIGIBLE. Every response says `outreachAllowed: false`. READY_FOR_REVIEW means the configured evidence checks passed, not legal clearance or permission to send.

## Internal API

Both POST endpoints require `x-aps-internal-key: APS_INTERNAL_API_KEY`, use no-store responses, validate strict JSON, and limit bodies to 256 KiB.

`/api/internal/compliance/evaluate` accepts `{campaignId, leadId, contactId, channel}`. Channel is SMS, CALL, or EMAIL. All IDs must belong to the same customer and the contact must belong to the lead. Active enrollment, customer, requested channel, campaign status (READY/RUNNING), campaign dates, contact type/validity, lead status, consent, evidence freshness, and applicable suppressions are checked. Returns BLOCKED with reasons or READY_FOR_REVIEW, always with outreach disabled. Evaluation uses a consistent database snapshot and writes an audit event; it is informational, never an authorization token for later sending.

`/api/internal/compliance/evidence` accepts the same target plus `requestId`, `actorRef`, `evidenceRef`, `observedAt`, and one action:

- CHECK: `check`, `outcome` (PASS/FAIL/UNKNOWN), `expiresAt`. Checks: CONTACT_OWNERSHIP, JURISDICTION_REVIEW, DNC, REASSIGNED_NUMBER, EMAIL_DELIVERABILITY.
- CONSENT: `status` (GRANTED/REVOKED); grants require `expiresAt`.
- SUPPRESS: `reason` (DNC, OPT_OUT, WRONG_NUMBER, COMPLAINT, INVALID_CONTACT, INTERNAL, LEGAL, OTHER).

Use unique request IDs of 8–100 letters, digits, underscores or hyphens. Identical retries return the same evidence ID; changed payloads conflict. The receipt, consent and suppression changes commit atomically under a request lock. Evidence is append-only through this API. Operator IDs and evidence references are supplied by trusted internal callers, not independently authenticated identities. Keep references opaque: no names, phone numbers, email addresses, documents, or credentials in these fields. Store original evidence in an appropriately controlled external system.

All channels require explicit supported consent, ownership verification and jurisdiction review. Phone channels also require DNC and reassigned-number checks; email requires deliverability. Checks expire within 31 days of observation (an APS policy, not a legal freshness standard). Future observations and expired evidence are rejected. Newer failed/unknown checks and tied failures take precedence. Existing unsupported consent cannot silently qualify. Missing external verification stays blocked.

Evidence is bound to the contact value/type and campaign industry, targeting, outreach configuration and territories. Changed context requires new evidence. Reviews inspect at most 501 audit and consent rows; more than 500 blocks for operator review rather than assuming older evidence is irrelevant.

Revocation creates a persistent customer-wide suppression for the normalized contact value across channels and duplicate leads. Regranting consent does not remove it. GLOBAL, CUSTOMER and CAMPAIGN suppressions are respected by value, contact, lead or whole scope. There is no suppression removal endpoint. Imported provider restrictions remain in force.

## Setup still pending

External DNC, reassigned-number, ownership/deliverability verification, and jurisdiction review workflows are not connected. An authorized operator must obtain real evidence before recording PASS; BatchData contact enrichment is not consent or clearance. Automated legal-rule evaluation, sender registration, sending windows, frequency caps and outreach are outside this step. Any future sending system must re-evaluate current evidence and suppressions at dispatch and implement its own complete controls.

No new secrets or schema migration are required. Existing Neon tables store evidence, consent, suppression and audit records. Paid BatchData execution remains disabled until the deferred final setup test. No live BatchData calls are part of validation.

Validation: unit coverage for conservative policy decisions; isolated Neon synthetic integration coverage for lineage, duplicate concurrent requests, changed-payload conflicts, context invalidation, persistent opt-outs across duplicate contacts, and absence of messages/raw contact values in audit events. TypeScript, Prisma validation and production build are required before release.

Background references (not a complete legal specification): [FTC commercial email guidance](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business), [FCC consent revocation order](https://docs.fcc.gov/public/attachments/FCC-24-24A1.pdf), [FCC reassigned-number database guidance](https://docs.fcc.gov/public/attachments/DA-23-62A1_Rcd.pdf).
