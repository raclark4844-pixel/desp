-- Non-destructive compatibility migration discovered during Step 2 CI.
-- Keeps existing Step 1 columns while adding the fields expected by the checked-in Prisma schema.

ALTER TABLE "ProviderJob"
  ADD COLUMN IF NOT EXISTS "finishedAt" timestamptz;

ALTER TABLE "Cost"
  ALTER COLUMN "customerId" DROP NOT NULL;

ALTER TABLE "Cost"
  ADD COLUMN IF NOT EXISTS "quantity" numeric(12,4);

ALTER TABLE "Cost"
  ADD COLUMN IF NOT EXISTS "incurredAt" timestamptz NOT NULL DEFAULT now();

UPDATE "Cost"
SET "incurredAt" = "createdAt"
WHERE "createdAt" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "Cost_customerId_incurredAt_idx"
  ON "Cost"("customerId", "incurredAt");

CREATE INDEX IF NOT EXISTS "Cost_campaignId_incurredAt_idx"
  ON "Cost"("campaignId", "incurredAt");

CREATE INDEX IF NOT EXISTS "Cost_type_provider_idx"
  ON "Cost"("type", "provider");

ALTER TABLE "AuditEvent"
  ADD COLUMN IF NOT EXISTS "payload" jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE "AuditEvent"
SET "payload" = "data"
WHERE "data" IS NOT NULL;

ALTER TABLE "AuditEvent"
  ADD COLUMN IF NOT EXISTS "ipAddress" text;
