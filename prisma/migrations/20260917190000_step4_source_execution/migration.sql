ALTER TYPE "ProviderJobStatus" ADD VALUE IF NOT EXISTS 'BLOCKED';
ALTER TYPE "ProviderJobStatus" ADD VALUE IF NOT EXISTS 'WAITING_MANUAL';
ALTER TABLE "Lead" ADD COLUMN "identityKey" TEXT;
CREATE UNIQUE INDEX "Lead_customerId_identityKey_key" ON "Lead"("customerId", "identityKey");
ALTER TABLE "ProviderJob" ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "nextAttemptAt" TIMESTAMPTZ(6),
  ADD COLUMN "leaseToken" UUID,
  ADD COLUMN "leaseExpiresAt" TIMESTAMPTZ(6);
CREATE UNIQUE INDEX "ProviderJob_idempotencyKey_key" ON "ProviderJob"("idempotencyKey");
CREATE INDEX "ProviderJob_jobType_status_nextAttemptAt_idx" ON "ProviderJob"("jobType", "status", "nextAttemptAt");
CREATE TABLE "SourceReceipt" (
  "id" UUID NOT NULL, "jobId" UUID NOT NULL, "key" TEXT NOT NULL,
  "digest" TEXT NOT NULL, "result" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SourceReceipt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SourceReceipt_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ProviderJob"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SourceReceipt_jobId_key_key" ON "SourceReceipt"("jobId", "key");
