# Step 7 — private operations dashboard

Open `/operations` and sign in with the existing `APS_INTERNAL_API_KEY`. Authorized APS operators can search customers by company name or slug, select a campaign, view enrolled-lead/contact totals, job status/attempts, recent audit event types, and configuration readiness. Key presence is never presented as a successful live provider test. This step does not run BatchData, activate campaigns, change customer state, record consent, or send outreach.

The server exchanges the key for a signed, purpose-scoped, 30-minute HttpOnly SameSite=Strict cookie (Secure in production). Raw keys are not stored in local/session storage or returned in cookies. Login and logout enforce same-origin requests. Key rotation invalidates existing sessions. The session grants read-only dashboard access only; existing mutation routes continue to require their internal header. Sign-out clears the current cookie; stateless copied cookies remain valid until expiry or key rotation. This is shared operator access, not individual customer accounts, per-user access control, or an identity/audit solution. Never share this key with customers; it also authorizes existing internal APIs. Future customer access requires dedicated identity and tenant authorization.

`GET /api/internal/operations` accepts `search` (up to 100 characters), `customerId`, and `campaignId`. It requires the scoped dashboard cookie or existing internal header. A selected campaign must belong to its selected customer. It returns at most 50 customers, 50 recent campaigns, 25 recent jobs and 15 recent event types. Truncation is shown in the UI; this first version has no older-campaign/job pagination. Counts cover the selected campaign, including all matching jobs. Queries explicitly exclude owner names, phone/email values, provider payloads, evidence contents, and credentials. Responses are private/no-store, errors are sanitized. Counts and lists are read-only live queries and may change during active processing; they are not a transactionally consistent export.

Readiness panels distinguish configured keys, disabled execution, and missing external verification. They do not infer legal clearance, provider billing entitlement, scheduler health, or successful authentication from environment variables. Evidence and consent review remains in Step 6's protected APIs. Customer status controls, campaign activation and retry/import buttons are intentionally future work, requiring explicit action boundaries in the UI.

## Validation

- Unit checks: signed/expired/tampered sessions, key rotation, origin validation, unauthenticated rejection, cookie protections, inability to use dashboard cookies on mutation endpoints.
- Isolated Neon integration: customer/campaign matching, contact/lead totals, job statuses, empty searches, input bounds and exclusion of confidential fields.
- Browser: sign-in, customer selection/search, rendering and sign-out against synthetic test data.
- Prisma validation, TypeScript, build and production health.

No new database migration or API key is required. Live BatchData testing remains deferred until remaining setup is complete. The next setup work is connecting trusted verification evidence and adding operator review actions before the final provider test; outreach remains out of scope.
