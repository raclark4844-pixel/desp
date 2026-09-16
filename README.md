# APS Lead Engine — Steps 1–3

APS Lead Engine is the backend and campaign-intake foundation for AP Spartan's multi-industry lead-generation platform. The system is designed so one permanent customer/campaign/lead identity follows a prospect through sourcing, enrichment, compliance, outreach, qualification, delivery, and reporting.

## Current scope

### Step 1 — Data foundation

- PostgreSQL / Neon database with permanent UUIDs for customers, campaigns, leads, conversations, messages, appointments, deliveries, provider jobs, costs, and audit events.
- Campaign/lead enrollment model so one canonical `leadId` can participate in workflows without disconnected duplicate records.
- Property and contact normalization.
- Consent evidence and suppression/DNC records as first-class data.
- Provider-job tracking for PropWire, BatchLeads / BatchData, PhantomBuster, TextGrid, and other adapters.
- Cost attribution and audit history.
- Production-oriented indexes for territory, compliance, messaging, and reporting workloads.

### Step 2 — Campaign Builder + orchestration API foundation

- Next.js App Router campaign builder at `/campaigns/new`.
- Industry-aware targeting profiles for roofing, HVAC, solar, windows/siding, landscaping, remodeling, real estate, mortgage, concrete, decks/outdoor living, and custom industries.
- Multi-territory campaigns supporting counties, ZIP codes, cities, and states.
- Customer/company intake, lead-count goals, residential/commercial selection, service level, campaign dates, and requested communication channels.
- Zod server-side validation plus spam honeypot protection.
- Atomic campaign creation: customer, customer-admin identity, campaign, territories, targeting configuration, and audit event are written in one database transaction.
- Draft-only safety: public intake creates `DRAFT` campaigns and does not purchase data or contact prospects.
- Protected internal activation route using `x-aps-internal-key`.
- Database-backed health endpoint.
- Automated GitHub CI for Prisma validation, TypeScript checking, and production Next.js builds.

### Step 3 — Lead Source Router

- Deterministic provider router converts a campaign into a normalized lead-source query using the campaign ID, customer ID, industry, desired lead count, residential/commercial flags, territories, and targeting configuration.
- BatchData / BatchLeads is preferred when `BATCHDATA_API_KEY` is configured because it provides an API-first property-data path.
- PropWire is retained as the current property-data fallback and is queued as a manual export/import job until approved API access is available.
- PhantomBuster can be added as a supplemental automation route for commercial/custom business prospecting when `PHANTOMBUSTER_API_KEY` is configured.
- Campaign activation now automatically dispatches the `APS_ORCHESTRATOR / FIND_LEADS` job through the router instead of leaving it as an unprocessed queue record.
- Selected providers are upserted into `LeadSource`, and provider-specific source jobs are queued in `ProviderJob` with the same permanent `campaignId`.
- Routing is idempotent: a completed `FIND_LEADS` routing job is reused instead of generating duplicate source jobs.
- Every routing decision is written to `AuditEvent`.
- The protected provider-status endpoint reports which provider connectors are configured without exposing credentials.
- Step 3 only routes/queues sourcing work. It does not yet call BatchData, run PhantomBuster, import PropWire exports, enrich contacts, or send outreach.

## Stack

- Next.js 16.3.5
- React 19.3.0
- Zod 4.6.5
- PostgreSQL / Neon
- Prisma ORM 7.10.0
- `@prisma/adapter-pg`
- Node.js 20.19+

## Routes

### User-facing

- `GET /` → redirects to `/campaigns/new`
- `GET /campaigns/new` → APS Campaign Builder

### Public/API foundation

- `POST /api/campaigns` → validates intake and creates a campaign draft
- `GET /api/industries` → returns current industry targeting profiles
- `GET /api/health` → verifies the application can reach PostgreSQL

### Protected APS-only routes

All protected routes require `x-aps-internal-key`.

- `POST /api/campaigns/:campaignId/activate` → activates the campaign, creates/reuses `FIND_LEADS`, and automatically routes it to source jobs
- `POST /api/internal/provider-jobs/:jobId/dispatch` → safely retries/displays Step 3 routing for a `FIND_LEADS` provider job
- `GET /api/internal/lead-sources` → reports provider configuration, execution mode, and capabilities without exposing secrets

## Environment variables

Copy `.env.example` to `.env.local` for local Next.js development.

- `DATABASE_URL` — pooled PostgreSQL connection for runtime traffic
- `DIRECT_URL` — preferred direct/unpooled PostgreSQL connection for migrations and administration; Prisma build tooling can fall back to `DATABASE_URL`
- `APS_INTERNAL_API_KEY` — long random secret used only by protected APS orchestration routes
- `BATCHDATA_API_KEY` — optional in Step 3; when present, BatchData becomes the preferred automated property-data route
- `PHANTOMBUSTER_API_KEY` — optional supplemental commercial/custom prospecting automation route

Never commit database credentials, API keys, or `.env*` secret files.

## Development

```bash
npm install
npm run db:validate
npm run typecheck
npm run dev
```

Production build validation:

```bash
npm run build
```

Every push to `main` also runs GitHub Actions validation for the Prisma schema, TypeScript, and the optimized production build.

## Campaign lifecycle implemented so far

```text
Campaign Builder
      ↓
Validate intake
      ↓
Create/reuse Customer
      ↓
Create Customer Admin identity
      ↓
Create Campaign (DRAFT)
      ↓
Attach Territories + Targeting Profile
      ↓
Audit Event
      ↓
APS-only activation
      ↓
Create/reuse FIND_LEADS orchestration job
      ↓
Lead Source Router
      ↓
Rank approved source paths
      ↓
Upsert LeadSource record(s)
      ↓
Queue provider-specific SOURCE_LEADS job(s)
      ↓
Campaign RUNNING
```

No provider is allowed to send outreach in this lifecycle. Compliance, enrichment, and communications remain downstream gates.

## Targeting guardrail

APS campaign targeting must not use protected-class or sensitive-personal-data criteria. The current builder and router are structured around lawful property, geography, business, and service-relevance signals. Provider-specific compliance controls will be layered in before outreach is enabled.

## Not implemented yet

The following remain downstream work after Step 3:

- Execute BatchData / BatchLeads source jobs against the provider API
- PropWire import automation or approved API connector
- PhantomBuster execution and result ingestion
- Contact/property enrichment and normalization
- Deduplication / lead quality scoring
- DNC, consent, suppression, reassigned-number, and state-specific compliance engine
- TextGrid outbound/inbound SMS and 10DLC workflow
- Email/calling providers
- AI reply and qualification agents
- Automated appointments
- Client lead delivery
- Client/admin dashboard
- Optimization/retraining loops

Those layers plug into the `ProviderJob`, lead, property, contact, consent, suppression, conversation, qualification, delivery, cost, and audit models already established.
