# APS Lead Engine — Steps 1–2

APS Lead Engine is the backend and campaign-intake foundation for AP Spartan's multi-industry lead-generation platform. The system is designed so one permanent customer/campaign/lead identity follows a prospect through sourcing, enrichment, compliance, outreach, qualification, delivery, and reporting.

## Current scope

### Step 1 — Data foundation

- PostgreSQL / Neon database with permanent UUIDs for customers, campaigns, leads, conversations, messages, appointments, deliveries, provider jobs, costs, and audit events.
- Campaign/lead enrollment model so one canonical `leadId` can participate in workflows without disconnected duplicate records.
- Property and contact normalization.
- Consent evidence and suppression/DNC records as first-class data.
- Provider-job tracking for future PropWire, BatchLeads, PhantomBuster, TextGrid, and other adapters.
- Cost attribution and audit history.
- Production-oriented indexes for territory, compliance, messaging, and reporting workloads.

### Step 2 — Campaign Builder + orchestration API foundation

- Next.js App Router campaign builder at `/campaigns/new`.
- Industry-aware targeting profiles for roofing, HVAC, solar, windows/siding, landscaping, remodeling, real estate, mortgage, concrete, decks/outdoor living, and custom industries.
- Multi-territory campaigns supporting counties, ZIP codes, cities, and states.
- Customer/company intake, lead-count goals, residential/commercial selection, service level, campaign dates, and requested communication channels.
- Zod server-side validation plus spam honeypot protection.
- Atomic campaign creation: customer, customer-admin identity, campaign, territories, targeting configuration, and audit event are written in one database transaction.
- Draft-only safety: public intake creates `DRAFT` campaigns and **does not** purchase data or contact prospects.
- Protected internal activation route that can transition a campaign to `READY` and queue one `APS_ORCHESTRATOR / FIND_LEADS` provider job.
- Idempotent activation protection against duplicate queued/running source jobs.
- Database-backed health endpoint.
- Automated GitHub CI for Prisma validation, TypeScript checking, and production Next.js builds.

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

### API

- `POST /api/campaigns` → validates intake and creates a campaign draft
- `GET /api/industries` → returns current industry targeting profiles
- `GET /api/health` → verifies the application can reach PostgreSQL
- `POST /api/campaigns/:campaignId/activate` → protected APS-only activation endpoint; requires `x-aps-internal-key`

## Environment variables

Copy `.env.example` to `.env.local` for local Next.js development.

- `DATABASE_URL` — pooled PostgreSQL connection for runtime traffic
- `DIRECT_URL` — direct/unpooled PostgreSQL connection for migrations and administration
- `APS_INTERNAL_API_KEY` — long random secret used only by protected APS orchestration routes

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
Campaign READY
      ↓
Queue FIND_LEADS job
```

The final box is intentionally a queue record only. No lead-source provider is called in Step 2.

## Targeting guardrail

APS campaign targeting must not use protected-class or sensitive-personal-data criteria. The current builder is structured around lawful property, geography, business, and service-relevance signals. Provider-specific compliance controls will be layered in before outreach is enabled.

## Not implemented yet

Step 2 intentionally does **not** connect or launch:

- PropWire / BatchLeads / BatchData sourcing
- PhantomBuster automations
- TextGrid outbound or inbound SMS
- Email/calling providers
- AI reply or qualification agents
- Automated appointments
- Client lead delivery
- Optimization/retraining loops

Those are downstream steps and should plug into the `ProviderJob`, lead, compliance, conversation, qualification, and delivery models already established.
