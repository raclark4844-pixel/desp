-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "primaryAlertTargetId" UUID;

-- AlterTable
ALTER TABLE "EmployeeSession" ADD COLUMN     "aiDecidedAt" TIMESTAMPTZ(6),
ADD COLUMN     "aiEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "aiEnabledAt" TIMESTAMPTZ(6),
ADD COLUMN     "aiVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ReplyNotification" ADD COLUMN     "body" TEXT,
ADD COLUMN     "destinationSnapshot" TEXT,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'REPLY';

-- CreateTable
CREATE TABLE "AiObservation" (
    "id" UUID NOT NULL,
    "messageId" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "summary" TEXT,
    "question" TEXT,
    "answer" TEXT,
    "knowledgeStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "AiObservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiObservation_messageId_key" ON "AiObservation"("messageId");

-- CreateIndex
CREATE INDEX "AiObservation_conversationId_createdAt_idx" ON "AiObservation"("conversationId", "createdAt");

