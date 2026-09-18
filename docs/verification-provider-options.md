# Verification provider recommendation

Prices checked September 18, 2026. Recommendation assumes an initial U.S. pilot of about 1,000 phone numbers, with API automation and a low upfront commitment. It is not a claim of the cheapest provider at every volume. No account or subscription has been purchased.

| Option | Published cost | Fit / limitation |
| --- | --- | --- |
| RealPhoneValidation DNC Lookup | Starts at $0.02 per check; $25 minimum account funding | Recommended for the pilot: national/state/DMA DNC, known-litigator and phone-type results; API available. No need to prepay a large volume. |
| Official Reassigned Numbers Database (RND) | $8 / 1,000 queries for one month; $60 / 10,000 | Recommended for reassignment screening. API available after registration/subscription. Requires a supported prior consent or last-known-contact date. |
| DoNotCallDNC / Robixx prepaid API | $100 / 60,000 credits, no expiration or recurring charge | Lower published per-lookup cost (~$0.001667), higher initial outlay. Advertises U.S. federal DNC; state-list and reassignment coverage are not established by that offer, so it is not an equivalent replacement for the recommended pair. |
| DNC.com / Contact Center Compliance | Quote required | Broad API/compliance offering, but total/minimum cost cannot be compared without an actual quote. |

For the recommended pair: $25 initial DNC balance + $8 RND one-month tier = $33 initial provider funding. At the published starting DNC rate, checking 1,000 numbers consumes $20 of that DNC balance; the combined consumed/plan cost is approximately $28. These estimates exclude taxes, applicable federal/state registry access fees, extra products, additional checks, and future months. Confirm account-specific pricing and permissions before buying; funding and registry access are different costs.

Official federal DNC access provides the first five subscribed telephone area codes free. FY2026 additional area codes are $82 each annually; starting October 1, 2026, FY2027 pricing becomes $85 per additional area code. Phone area codes are not campaign ZIP codes, and a homeowner's mobile area code may be outside the property's location. Separate state requirements may apply. A vendor's API payment does not automatically establish the seller's registry access rights.

## Account setup needed from the account owner

1. Register the relevant seller with the FTC National DNC Registry business portal and obtain the appropriate Subscription Account Number (SAN), Organization ID, expiration and area-code coverage. RealPhoneValidation requires these details. For multiple client sellers, confirm each seller's authorization/registration rather than sharing one customer's scope across all customers.
2. Create a RealPhoneValidation business account. Confirm DNC Lookup API pricing, coverage and client/agency use. Keep automatic recharge off for the initial pilot unless explicitly desired. Obtain the server API credential after account setup; do not paste it into chat or commit it to GitHub.
3. Register with the official RND as the appropriate Caller or Caller Agent. Caller Agents need a client company and Letter of Authorization per client. Its API guide and credentials are available to registered accounts. Subscribe only when ready for the final test.
4. Supply account entitlement/authorization details and configure credentials securely in Vercel when the selected provider adapters are implemented. No provider key is required for Step 8's manual evidence review controls.

RND needs the actual prior consent/known-contact date; a newly purchased BatchData record does not establish that date. A result of no data or an indeterminate result must stay unknown, not pass. Both recommendations still leave ownership, channel-specific consent, jurisdiction review and email verification evidence to resolve. No provider is currently connected by this release, and nothing here authorizes outreach.

Sources:
- [RealPhoneValidation quote/prices](https://realphonevalidation.com/quote/)
- [RealPhoneValidation funding and API FAQ](https://realphonevalidation.com/faq/)
- [DNC Lookup coverage and SAN requirements](https://realphonevalidation.com/do-not-call-list-scrubbing/)
- [Official RND current pricing](https://www.reassigned.us/pricing)
- [Official RND query requirements](https://www.reassigned.us/node/43)
- [Official RND API guide access](https://www.reassigned.us/resources/guides)
- [Robixx prepaid API prices](https://www.donotcalldnc.com/api/prepaid-pricing/)
- [DNC.com service pricing is set in the service order](https://www.dnc.com/services-agreement)
- [FTC FY2026 fees](https://www.ftc.gov/news-events/news/press-releases/2025/08/telemarketer-fees-access-ftcs-national-do-not-call-registry-increase-2026)
- [FTC FY2027 fees](https://www.ftc.gov/news-events/news/press-releases/2026/08/ftc-announces-2027-telemarketer-fees-access-national-do-not-call-registry)
