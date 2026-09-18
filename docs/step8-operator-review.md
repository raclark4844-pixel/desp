# Step 8 — operator contact review

From `/operations`, select a campaign and choose **Review campaign contacts**. The review page lists masked contacts for active enrollments, 50 per page, with a UUID cursor for the next page. Permanent campaign/lead/contact IDs remain intact. Email values are omitted; valid U.S. phone numbers display their last four digits only.

Operators can run a current per-channel readiness evaluation and see why it is blocked. A successful evaluation remains READY_FOR_REVIEW with outreach disabled. Evaluations use the Step 6 policy and append an audit event, but do not change consent, suppressions, job status, or lead status.

The evidence form supports verification outcomes, consent grants/revocations and suppressions. It requires the operator reference, controlled evidence reference, actual observation date, applicable expiry, an acknowledgement, and the APS internal key for each save. Unknown/revoked defaults avoid preselecting positive evidence. The read-only dashboard cookie alone cannot save evidence. The key is cleared after submission and is not persisted. Same-origin checks apply to review POSTs, including calls with the internal header. Machine callers of these new UI routes must send the correct Origin; existing Step 6 internal APIs remain unchanged.

The UI reuses the same request ID for identical payload retries while the page remains mounted. After a lost response, keep fields unchanged and re-enter the key. Reloading loses the in-memory request ID; for durable machine retries use the original Step 6 API and persist the request ID externally. Saving evidence invalidates the displayed decision and requires a fresh review. The API's append-only audit, transactional consent/suppression and idempotency protections remain in force.

## Routes

- GET `/api/internal/operations/review?campaignId=UUID&after=UUID` — scoped dashboard session or internal key; returns active enrolled contacts belonging to the campaign's customer; no raw contact values.
- POST `/api/internal/operations/review` — same authorization plus same origin; strict Step 6 target; evaluates current readiness and logs the review.
- POST `/api/internal/operations/review/evidence` — internal key and same origin; strict `{acknowledged: true, evidence: <Step 6 evidence>}` body, bounded at 256 KiB; records verified evidence.

These are internal operator controls, not customer account access. Shared keys do not prove an individual operator's identity; actor references remain supplied assertions. Human reviewers must actually inspect the evidence. The UI does not verify the truth of an evidence reference or auto-generate consent. Contact details may change; always match current controlled records before saving. There is no suppression removal, campaign activation, paid lookup or send action on this page.

## External services

No verification vendor is yet connected. The account owner has no existing provider account, so provider selection/pricing was researched rather than inventing credentials or purchasing subscriptions. See [dated provider comparison and setup requirements](verification-provider-options.md). Recommended small-pilot combination: RealPhoneValidation DNC Lookup plus official RND. Both require account setup/authorization before implementation and live verification; no current credential is missing for the review UI itself. Live BatchData testing remains deferred.

## Verification

Unit tests cover masking, unauthenticated rejection, read-session write rejection, origin enforcement and required acknowledgement. Isolated Neon tests cover pagination without overlap, active enrollment filtering, successful evidence save/replay, opt-out suppression evaluation and no messages. Browser checks cover navigation, contact selection, evaluation and synthetic evidence save. Prisma, TypeScript and production build must pass before deployment. No database schema change is needed.
