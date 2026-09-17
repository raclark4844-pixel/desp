# Step 4: property-source execution

This layer sources properties only. It does not call, message, skip trace, enrich contacts, grant consent, or mark anyone eligible for outreach. New leads remain NEW; existing statuses and suppressions are preserved. All imported campaign associations require compliance review.

## Configuration

Use the existing Neon `DATABASE_URL`. `DIRECT_URL` is preferred for migrations.

- `APS_INTERNAL_API_KEY`: long random server-side secret for every internal endpoint below.
- `BATCHDATA_API_KEY`: a BatchData API token entitled to Property Search. A BatchLeads web login or unrelated BatchLeads key is not interchangeable. Never use a NEXT_PUBLIC variable.
- `CRON_SECRET`: separate random server-side secret. Vercel sends Bearer auth to the worker every five minutes. Without it, the scheduled endpoint returns 401; manual internal POST execution still works.

Set values in Vercel Production (and separate keys for Preview/Development if needed), then redeploy. Build logs report presence only, never values. PropWire needs no API key and is never scraped. PhantomBuster remains a routing option, but its execution jobs enter BLOCKED / PROVIDER_NOT_IMPLEMENTED in this release.

## Endpoints

All paths below are under `/api/internal/provider-jobs`. Use `x-aps-internal-key: <APS_INTERNAL_API_KEY>`.

| Method | Path               | Behavior                                                                                                                     |
| ------ | ------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/:jobId/dispatch` | Existing FIND_LEADS router; concurrent dispatches serialize and reuse child jobs.                                            |
| POST   | `/:jobId/execute`  | Execute one page, or return the current state if already complete, leased, blocked or not due.                               |
| GET    | `/:jobId`          | Job state, progress counts and safe error code.                                                                              |
| POST   | `/worker`          | Process one eligible queued job or expired lease.                                                                            |
| POST   | `/:jobId/retry`    | Explicitly requeue a BLOCKED/FAILED job after the cause is fixed; cursor stays intact.                                       |
| POST   | `/:jobId/fallback` | Cancel a queued/blocked/failed API job and create/reuse its PropWire manual job on the same campaign. Existing leads remain. |
| POST   | `/:jobId/import`   | Import up to 100 normalized property rows for a PropWire job, with an idempotency key.                                       |

Scheduled `GET /worker` accepts only `Authorization: Bearer <CRON_SECRET>`. Missing or invalid credentials always fail closed. The worker does not dispatch FIND_LEADS parents; retain Step 3's dispatch step before execution.

## PropWire manual import

Export your authorized PropWire property list manually, map the export columns to the JSON below, then POST to the manual job's `/import` endpoint. No file is pulled from PropWire by the application. Required address fields are address1, city, state and postalCode. Include propertyType for residential-only or commercial-only campaigns; missing constrained attributes are rejected. Only these normalized property fields are accepted; contact details, demographic fields and consent assertions are not accepted.

```json
{
  "idempotencyKey": "propwire-export-20260917-page-001",
  "final": true,
  "records": [
    {
      "externalRef": "optional-provider-property-id",
      "address1": "101 Example Street",
      "address2": "Unit 2",
      "city": "Austin",
      "state": "TX",
      "postalCode": "78704",
      "county": "Travis",
      "propertyType": "RESIDENTIAL",
      "yearBuilt": 1980,
      "ownerOccupied": true,
      "estimatedValue": 350000
    }
  ]
}
```

Use one stable idempotencyKey per batch and `final:false` until the last batch. Replaying identical content returns the committed receipt even after success. Reusing a key with different normalized content or a changed final flag returns 409. Entire malformed batches are rejected without writes. An empty final batch can close a manual job. Request bodies are limited to 256 KiB.

## Provider contract and targeting

BatchData: POST `https://api.batchdata.com/api/v1/property/search`, Bearer authentication, `{searchCriteria:{query}, options:{take,skip}}`, response `results.properties`. Contract reference: https://batchdata.io/blog/advanced-property-search-developer-guide and https://developer.batchdata.com/.

Step 4 sends geography only to the API and applies property-use, owner-occupancy, year-built and estimated-value filters locally before ingestion. This can consume more provider credits than native filtering. City/county searches require a two-letter state; ZIP and state searches are also supported. Missing property attributes do not satisfy a constraint. Unknown keys, customCriteria and leadType block execution pending review; free-text targeting never becomes provider instructions. Recommended industry criteria are advisory, not executable filters. No demographic targeting or outreach decisions are implemented.

The adapter discards provider fields outside its property allowlist. It never persists a complete raw owner/contact payload. Unknown property categories remain unknown rather than being guessed as residential or commercial. Invalid records are counted; an entirely malformed nonempty page blocks for investigation.

## State, retries and lineage

- QUEUED → RUNNING → QUEUED (another page) or SUCCEEDED.
- Transient network, 429 and 5xx failures retry with exponential backoff and bounded Retry-After; five attempts per page maximum, then FAILED.
- Missing/rejected keys, credits, unsupported providers/targeting and scan-budget limits → BLOCKED.
- PropWire → WAITING_MANUAL → SUCCEEDED when final is declared or the campaign target is reached.
- A 120-second lease and fencing token prevent concurrent/stale workers from committing. Each invocation awaits all work (60-second function limit, 15-second provider timeout, 30-second ingestion transaction).
- Each call fetches at most 100 records, each API job at most 100 pages. Reaching the scan budget requires manual fallback; retry does not reset that budget.
- Receipts, lead writes, campaign links, audit events and cursor progress commit together. Expired leases resume the last committed cursor.
- Unique customer + normalized property address identity retains the same leadId across providers/campaigns within that customer. Unit numbers are included. The same property for different customers remains separate. Each CampaignLead has one unique campaignId/leadId pair.
- Address identity standardizes case, whitespace, punctuation and ZIP+4. It is not geocoding: differently spelled streets/cities may still need reconciliation. Existing legacy leads with null identityKey are not automatically merged/backfilled.
- Provider network delivery is at least once. If a process dies after a billable response but before committing, recovery can repeat the provider request/charge. Database ingestion remains idempotent; there is no unsupported claim of provider-side exactly-once billing.
- Counts and completionReason distinguish TARGET_REACHED, SOURCE_EXHAUSTED and MANUAL_EXPORT_COMPLETE. Success does not claim the requested lead count was available. Inspect rejected/scanned counts for narrow filters.

## Database release and verification

The additive Step 4 migration adds two job states, lease/retry fields, unique idempotency/identity indexes and SourceReceipt. No prior data is deleted. The existing production database was created outside Prisma Migrate; establish the two prior migration baselines only after verifying those tables/compatibility columns exist. Never reset production or apply the initial table-creation migration over it.

```sh
# Only for the verified pre-existing Steps 1–3 database without migration history:
npx prisma migrate resolve --applied 20260916044402_init
npx prisma migrate resolve --applied 20260916050500_step2_runtime_compat
# Normal deployments after that:
npm run db:migrate:deploy
npm run db:validate
npm run typecheck
npm test
npm run build
```

Database migrations are an explicit release step, not run on every Vercel build. The deployment reuses the existing pooled DATABASE_URL.

Integration tests require DATABASE_URL pointing at an isolated Neon branch and `APS_ISOLATED_TEST_DB=true`, then `npm run test:integration`. They create synthetic fixtures, preserve them on the test branch for audit, and mock the provider so no billable API requests or prospect outreach occur. Do not point them at production. The unit tests and CI do not need a database or provider credentials.

### Dependency audit at release

The locked dependencies install and build successfully. `npm audit` also reports four high-severity findings in the existing pinned Prisma toolchain dependency chain (`deepmerge-ts`, `mysql2`, and parent packages). The suggested automatic fix downgrades Prisma across a major version; this release does not apply that incompatible change. Track a compatible Prisma toolchain update separately.
