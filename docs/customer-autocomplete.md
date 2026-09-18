# Saved customer autocomplete

Version 0.9.0 adds customer lookup to `/campaigns/new` using the existing Neon Customer table. Sign in at `/operations`, then type at least two characters in Company name. Search returns at most ten name/slug matches. Arrow keys change the highlighted match; Tab, Enter, or a click fills company name, website, primary contact, email, and time zone. Duplicate names show separate contact emails and reference slugs. Tab moves to the next field after selecting. Shift+Tab does not select.

A selected customer retains its permanent customer ID. Fields are read-only while selected; editing the company name or choosing “Use a new customer” clears the selection and saved fields. Saving a linked campaign requires the operator key, since the Operations cookie remains read-only. Search results are private and never cached. Inactive or incomplete customer records cannot be selected; this release does not include a customer profile editor or spreadsheet import. New customers are saved with their first campaign draft and become available to subsequent searches.

Customer `contactName` and `contactEmail` are dedicated business-contact fields. Migration `20260918120000_customer_contacts` adds them and backfills from the oldest active customer administrator where available. Existing accounts, roles and ownership remain unchanged. Public submissions create a new uniquely identified customer instead of matching and overwriting customers by name; they do not create login accounts. Existing-customer submissions reject stale/mismatched details and never update the master record.

Campaign creation remains DRAFT only, with audit history and no queued provider calls or outreach. This feature does not require FTC registration, new paid subscriptions, or additional API credentials. Customer information not represented by existing form fields (such as billing addresses or phone numbers) is outside this release.

Validation: Prisma schema/generation, TypeScript, unit suite, production build, isolated Neon migration and customer integration tests. Browser verification covers private lookup, keyboard selection and saved customer lineage.
