# RealPhoneValidation connector preparation — 0.8.1

The DNC Lookup adapter is implemented and tested with an injected simulated transport while FTC registration is pending. It is deliberately not connected to an execution route, scheduler, dashboard lookup button, or evidence writer. No live provider request or billing occurred. The dashboard correctly continues to report verification services as not connected.

The adapter targets the documented HTTPS DNCLookup endpoint using form-encoded POST with JSON output. Tokens and phone numbers stay out of URLs; redirects are rejected. It limits responses to 32 KiB, times out requests after 15 seconds, returns sanitized errors and never automatically retries a potentially paid request.

Outbound calls require explicit `APS_RPV_DNC_ENABLED=true`, `RPV_API_TOKEN`, and a trusted per-customer authorization object containing SAN, Organization ID, expiration, subscribed telephone area codes and confirmation that the provider account is set up. The object must match the customer and the queried number's area code. These local checks do not independently verify an FTC registration or prove provider authorization. Future workers must load reviewed authorization records server-side, not accept public caller assertions. Tokens must belong to an account authorized for that seller; a global environment token is not permission to use one client's registration for another.

The parser accepts only explicit N flags for national/state/DMA DNC and known-litigator screening as PASS. Any Y produces FAIL; missing, unexpected or question-mark flags produce UNKNOWN unless a restrictive Y is present. PASS is only a screening outcome: it grants no consent or contact permission. If the optional echoed phone number is present it must match; the provider's documented JSON example does not echo a phone number, so correlation otherwise relies on the single-number request/response. Raw provider messages, contact values, credentials, demographics and unrelated fields are excluded from normalized results.

## Work remaining after registration

1. Confirm seller/agency registration, subscribed area codes, expiration and provider entitlement. Configure the API token securely in Vercel; keep the enable flag false.
2. Implement trusted authorization storage, durable job idempotency/leases, account-wide rate limiting below the provider's 10 requests/second recommendation, and cost tracking. This standalone adapter has no global rate limiter or duplicate-charge protection and must not be exposed directly as a live route.
3. Integrate normalized outcomes transactionally with Step 6 evidence and suppression logic, preserving existing opt-outs and rechecking contact/campaign context. A clean lookup must never delete restrictions or grant consent.
4. With explicit activation and a bounded test budget, run a controlled live acceptance test and confirm the account-specific response contract. Keep automatic retries disabled for ambiguous outcomes. Outreach remains disabled and live BatchData testing remains deferred.

No database migration is needed for this preparation. Unit tests cover disabled traffic, missing keys, expired/mismatched/uncovered authorizations, request shape, provider errors, missing flags, mismatched numbers, bounded response parsing, sanitized failures and single-attempt behavior.

Source: [RealPhoneValidation DNC Lookup API documentation](https://realphonevalidation.com/api-documentation/dnc-lookup-api-doc/), checked September 18, 2026. FTC registration is a prerequisite for DNC Lookup; ordinary phone formatting or internal workflow tests do not require a paid DNC lookup.
