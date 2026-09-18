CREATE TABLE "OutboundBatch" (
 "id" UUID PRIMARY KEY, "campaignId" UUID NOT NULL REFERENCES "Campaign"("id") ON DELETE RESTRICT,
 "channel" "ConsentChannel" NOT NULL, "position" SERIAL NOT NULL UNIQUE,
 "status" TEXT NOT NULL DEFAULT 'DRAFT', "subject" TEXT NOT NULL DEFAULT '', "body" TEXT NOT NULL,
 "mailingAddress" TEXT NOT NULL, "recipientTimezone" TEXT NOT NULL,
 "approvedBy" TEXT, "approvedAt" TIMESTAMPTZ(6), "queuedAt" TIMESTAMPTZ(6),
 "createdBy" TEXT NOT NULL, "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(), "updatedAt" TIMESTAMPTZ(6) NOT NULL,
 "lastDispatchAt" TIMESTAMPTZ(6), "reason" TEXT,
 UNIQUE ("campaignId","channel")
);
CREATE INDEX "OutboundBatch_status_position_idx" ON "OutboundBatch"("status","position");
CREATE TABLE "OutboundRecipient" (
 "id" UUID PRIMARY KEY, "batchId" UUID NOT NULL REFERENCES "OutboundBatch"("id") ON DELETE RESTRICT,
 "leadId" UUID NOT NULL, "contactId" UUID NOT NULL REFERENCES "Contact"("id") ON DELETE RESTRICT,
 "destination" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'PENDING', "reason" TEXT,
 "attempts" INTEGER NOT NULL DEFAULT 0, "nextAttemptAt" TIMESTAMPTZ(6), "attemptedAt" TIMESTAMPTZ(6),
 "providerId" TEXT UNIQUE, "bridgeStartedAt" TIMESTAMPTZ(6), "messageId" UUID UNIQUE,
 "unsubscribeToken" UUID NOT NULL UNIQUE, "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(), "updatedAt" TIMESTAMPTZ(6) NOT NULL,
 UNIQUE("batchId","destination")
);
CREATE INDEX "OutboundRecipient_batchId_status_idx" ON "OutboundRecipient"("batchId","status");
CREATE TABLE "OutboundReservation" ("key" TEXT PRIMARY KEY, "recipientId" UUID NOT NULL UNIQUE, "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW());
