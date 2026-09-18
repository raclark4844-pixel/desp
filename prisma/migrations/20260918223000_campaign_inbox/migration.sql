-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "smsSenderId" UUID;

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "assignedTo" UUID,
ADD COLUMN     "campaignHold" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "fromNumber" TEXT,
ADD COLUMN     "needsReply" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "replyToken" UUID,
ADD COLUMN     "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "Conversation" SET "replyToken" = gen_random_uuid() WHERE "replyToken" IS NULL;
ALTER TABLE "Conversation" ALTER COLUMN "replyToken" SET NOT NULL;

-- AlterTable
ALTER TABLE "OutboundBatch" ADD COLUMN     "smsFrom" TEXT;

-- CreateTable
CREATE TABLE "SmsSender" (
    "id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "customerId" UUID NOT NULL,
    "serviceSid" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "verifiedAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SmsSender_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboxReceipt" (
    "key" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "sender" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "conversationId" UUID,
    "reason" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InboxReceipt_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "InboxReply" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "reason" TEXT,
    "createdBy" TEXT NOT NULL,
    "providerId" TEXT,
    "messageId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "InboxReply_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationTarget" (
    "id" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "channel" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "confirmedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "NotificationTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReplyNotification" (
    "id" UUID NOT NULL,
    "targetId" UUID NOT NULL,
    "receiptKey" TEXT NOT NULL,
    "conversationId" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "providerId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ReplyNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReplyKnowledge" (
    "id" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "approvedBy" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReplyKnowledge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SmsSender_phone_key" ON "SmsSender"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "InboxReply_requestId_key" ON "InboxReply"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "InboxReply_providerId_key" ON "InboxReply"("providerId");

-- CreateIndex
CREATE UNIQUE INDEX "InboxReply_messageId_key" ON "InboxReply"("messageId");

-- CreateIndex
CREATE INDEX "InboxReply_conversationId_createdAt_idx" ON "InboxReply"("conversationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationTarget_campaignId_employeeId_channel_key" ON "NotificationTarget"("campaignId", "employeeId", "channel");

-- CreateIndex
CREATE INDEX "ReplyNotification_status_createdAt_idx" ON "ReplyNotification"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReplyNotification_targetId_receiptKey_key" ON "ReplyNotification"("targetId", "receiptKey");

-- CreateIndex
CREATE INDEX "ReplyKnowledge_campaignId_active_idx" ON "ReplyKnowledge"("campaignId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_replyToken_key" ON "Conversation"("replyToken");

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_smsSenderId_fkey" FOREIGN KEY ("smsSenderId") REFERENCES "SmsSender"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboxReply" ADD CONSTRAINT "InboxReply_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationTarget" ADD CONSTRAINT "NotificationTarget_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplyNotification" ADD CONSTRAINT "ReplyNotification_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "NotificationTarget"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplyKnowledge" ADD CONSTRAINT "ReplyKnowledge_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

