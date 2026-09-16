# APS Lead Engine — Step 1 Database Foundation

This repository contains Step 1 of the APS Lead Engine build: a production-oriented PostgreSQL data layer designed for Vercel plus a pooled PostgreSQL provider such as Neon.

## What Step 1 establishes

- Permanent UUIDs for customers, campaigns, leads, conversations, messages and deliveries.
- A campaign/lead enrollment table so one canonical `leadId` remains attached to the same lead across campaigns and downstream workflows.
- Property and contact normalization.
- Consent evidence and suppression records as first-class data.
- Provider-job tracking for future PropWire, BatchLeads, PhantomBuster and other source adapters.
- Conversation, qualification, appointment and delivery records for later automation.
- Cost attribution by customer, campaign, lead, provider and cost type.
- Audit events for important system actions.
- Database indexes for high-volume territory, compliance, messaging and dashboard lookups.

## Stack

- PostgreSQL
- Prisma ORM 7.10.0
- `@prisma/adapter-pg`
- Node.js 20.19+

Prisma 7 requires a driver adapter. Runtime traffic should use a pooled PostgreSQL URL; migrations should use a direct URL.

## Database setup

1. Copy `.env.example` to `.env`.
2. Set `DATABASE_URL` to the pooled PostgreSQL connection string.
3. Set `DIRECT_URL` to the direct PostgreSQL connection string.
4. Run `npm install`.
5. Run `npm run db:validate`.
6. Run `npm run db:generate`.
7. Once the production database exists, create/apply the first migration with `npm run db:migrate:dev -- --name init_aps_lead_engine` in development and `npm run db:migrate:deploy` in production.

Never commit `.env` or database credentials.

## Scope boundary

This commit intentionally implements **Step 1 only**. It does not yet create the Campaign Builder UI, orchestration API routes, lead-provider connectors, TextGrid messaging, AI reply agents or deployment automation. Those layers will use this data model in later steps.
