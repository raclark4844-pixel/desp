# Step 5: BatchData contact enrichment

Implemented and deployed separately from property sourcing. Live provider testing
is deferred until remaining setup is complete. **Do not enable production execution
or fund the provider as part of deployment.** All contacts remain unverified
candidates requiring compliance review. No calls, messages, consent grants, lead
eligibility transitions, demographic targeting or provider outreach are implemented.

## Configuration and rollout

- `BATCHDATA_ENRICHMENT_API_KEY`: separate server-side token with Property Lookup
  (`property-lookup-all-attributes`), Basic Property Data and Contact Enrichment.
  Saved as a Vercel Production Secret; never reuse the property-search credential.
- `APS_ENRICHMENT_ENABLED`: defaults to disabled; only the exact value `true`
  enables paid provider requests. Keep unset/false during setup.
- Existing `DATABASE_URL`, `APS_INTERNAL_API_KEY` and `CRON_SECRET` are reused.
- No schema migration is needed: jobs, contacts, receipts, suppressions and audits
  use the existing Neon schema. Release version: 0.5.0.

After setup, review account rates/funding, approve a small live acceptance sample,
enable execution and redeploy. Inspect results before requesting larger volumes.
The real API contract, entitlement, billing and matching quality are **not yet
verified with live requests**. Local tests mock the provider, and database tests
use synthetic fixtures on the isolated Neon branch.

## Protected endpoints

Every endpoint requires `x-aps-internal-key`. Credentials are server-side only.

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/internal/enrichment/jobs` | Queue an existing campaign/lead/property tuple |
| POST | `/api/internal/enrichment/jobs/:jobId/execute` | Process one enrichment job |
| POST | `/api/internal/enrichment/jobs/:jobId/retry` | Explicitly requeue a blocked/failed job |
| POST | `/api/internal/enrichment/worker` | Process at most one eligible job |
| GET | `/api/internal/provider-jobs/:jobId` | Existing safe status/counts endpoint |

Queue body: `{ "campaignId": "UUID", "leadId": "UUID", "propertyId": "UUID" }`.
It accepts only existing, active campaign enrollments with a property belonging to
that lead and the same customer. No arbitrary caller-supplied address is accepted.
One initial enrichment job per permanent lead is reused across its campaigns.
The returned campaignId is the original job's campaign. A different property for
the same already-enriched lead requires review; automatic refresh is out of scope.
Source ingestion does not automatically queue billable enrichment.

The existing five-minute source cron processes at most one job. Source work has
priority; when no source job is due it considers enrichment, only when enabled.
The separate protected enrichment worker supports manual processing to avoid
source-queue starvation. No second cron is installed.

## Provider contract and privacy

POST `https://api.batchdata.com/api/v1/property/lookup/all-attributes` with one
`requests[]` item containing the address and job UUID as `requestId`.
`options` is `{ "skipTrace": true, "datasets": ["basic", "contact"] }`.
Only a single property response with matching `property.meta.requestId` is accepted;
ambiguous results, missing owner data and dataset warnings block for review.

Owner `phoneNumbers[].number/type/dnc/tcpa`, `emails[]` and
`enrichedEmails[].email` are the allowlisted fields. US phone syntax is normalized
to +1 format and emails to lowercase. Syntax checks do not verify ownership or
deliverability. Existing contact validity and consent evidence are untouched.
Phone DNC/TCPA flags create restrictive suppression records, never permission.
Other provider fields are discarded, including names, household demographics,
financial information, litigation history and raw provider payloads.

This is not a complete compliance evaluator: owner-level restrictions, consent,
reassigned numbers, email deliverability and jurisdiction-specific checks still
require the downstream compliance layer. Contact-level suppression does not block
reusing an existing enrichment result; lead-level suppression blocks enrichment.
No contact is marked primary, valid, consented or eligible by this layer.

Sources inspected for this implementation:
- [BatchData Property Lookup](https://developer.batchdata.com/docs/batchdata/batchdata-v1/operations/create-a-property-lookup-all-attribute)
- [BatchData token and dataset setup](https://help.batchdata.io/en/articles/13238212-set-up-authentication-and-tokens-to-start-using-batchdata-apis)

## Transactions, retries and costs

Job row locks and a 120-second lease prevent parallel claims. Lead locks serialize
contact writes and deduplicate normalized values even when phone type differs.
Contacts, restrictions, receipt, audit and success status commit atomically. Lead
and campaign IDs remain unchanged, and lead status is never reset. Campaign,
customer, enrollment, property and lead suppression are rechecked before commit.
Audit/status payloads contain identifiers, counts and safe error codes, not contact
values, addresses, keys or provider error bodies.

Only explicit rate-limit responses automatically retry, up to three attempts with
backoff and bounded Retry-After. Network uncertainty, 5xx, expired leases and
uncommitted responses block for operator review to limit accidental repeat charges.
Retry body: `{ "acknowledgePossibleCharge": true }` is required after any attempt.
It may repeat a billable request; `requestId` is correlation, not a provider billing
idempotency guarantee. Completion replay does not call the provider again.

No invented dollar amount is recorded in Cost. Exact charges require account
pricing and provider billing reconciliation; queued jobs and attempts are not
equivalent to billable matches. The initial per-lead job limit is not a campaign
dollar budget. Keep execution disabled until spending controls are agreed.

## Verification

`npm test`, `npm run db:validate`, `npm run typecheck`, `npm run build`.
`npm run test:integration` requires an isolated Neon branch and
`APS_ISOLATED_TEST_DB=true`; never use production. Synthetic fixtures are retained.
Tests cover duplicate enqueue/execution, disabled traffic, contact normalization,
correlation mismatch, restrictions, consent preservation, cross-campaign reuse,
rate limiting, expired leases and pause-during-request rollback.

Next setup layer: compliance review and lead-readiness controls. Live BatchData
acceptance testing remains a final-setup checklist item, not a completed check.
