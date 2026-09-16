CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE "CustomerStatus" AS ENUM ('ACTIVE','PAUSED','SUSPENDED','CLOSED');
CREATE TYPE "UserRole" AS ENUM ('APS_ADMIN','APS_OPERATOR','CUSTOMER_ADMIN','CUSTOMER_USER');
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT','READY','RUNNING','PAUSED','COMPLETED','CANCELLED','FAILED');
CREATE TYPE "TerritoryType" AS ENUM ('ZIP','COUNTY','CITY','STATE','CUSTOM');
CREATE TYPE "LeadStatus" AS ENUM ('NEW','ENRICHING','ELIGIBLE','SUPPRESSED','CONTACTED','ENGAGED','QUALIFIED','DELIVERED','WON','LOST','INVALID');
CREATE TYPE "ContactType" AS ENUM ('MOBILE','LANDLINE','EMAIL','OTHER');
CREATE TYPE "ConsentChannel" AS ENUM ('SMS','CALL','EMAIL');
CREATE TYPE "ConsentStatus" AS ENUM ('UNKNOWN','GRANTED','REVOKED','NOT_REQUIRED');
CREATE TYPE "SuppressionScope" AS ENUM ('GLOBAL','CUSTOMER','CAMPAIGN');
CREATE TYPE "SuppressionReason" AS ENUM ('DNC','OPT_OUT','WRONG_NUMBER','COMPLAINT','INVALID_CONTACT','INTERNAL','LEGAL','OTHER');
CREATE TYPE "ConversationChannel" AS ENUM ('SMS','EMAIL','CALL','CHAT');
CREATE TYPE "ConversationStatus" AS ENUM ('OPEN','WAITING','QUALIFIED','CLOSED','ESCALATED');
CREATE TYPE "MessageDirection" AS ENUM ('OUTBOUND','INBOUND');
CREATE TYPE "MessageStatus" AS ENUM ('QUEUED','SENT','DELIVERED','FAILED','RECEIVED','SUPPRESSED');
CREATE TYPE "QualificationStatus" AS ENUM ('PENDING','IN_PROGRESS','QUALIFIED','UNQUALIFIED','NEEDS_HUMAN');
CREATE TYPE "AppointmentStatus" AS ENUM ('REQUESTED','SCHEDULED','CONFIRMED','COMPLETED','CANCELLED','NO_SHOW');
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING','SENT','ACKNOWLEDGED','FAILED');
CREATE TYPE "ProviderJobStatus" AS ENUM ('QUEUED','RUNNING','SUCCEEDED','FAILED','CANCELLED');
CREATE TYPE "CostType" AS ENUM ('DATA','ENRICHMENT','SMS','EMAIL','AI','OTHER');

CREATE TABLE "Customer" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "slug" text NOT NULL UNIQUE,
  "status" "CustomerStatus" NOT NULL DEFAULT 'ACTIVE',
  "websiteUrl" text,
  "timezone" text NOT NULL DEFAULT 'America/New_York',
  "externalCrm" text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "User" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "customerId" uuid REFERENCES "Customer"("id") ON DELETE CASCADE,
  "email" text NOT NULL UNIQUE,
  "name" text,
  "role" "UserRole" NOT NULL,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "Campaign" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "customerId" uuid NOT NULL REFERENCES "Customer"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "industry" text NOT NULL,
  "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
  "residential" boolean NOT NULL DEFAULT true,
  "commercial" boolean NOT NULL DEFAULT false,
  "desiredLeadCount" integer,
  "startAt" timestamptz,
  "endAt" timestamptz,
  "targetingConfig" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "outreachConfig" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "qualificationConfig" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "Territory" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "campaignId" uuid NOT NULL REFERENCES "Campaign"("id") ON DELETE CASCADE,
  "type" "TerritoryType" NOT NULL,
  "value" text NOT NULL,
  "state" text,
  "county" text,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("campaignId","type","value")
);

CREATE TABLE "LeadSource" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "key" text NOT NULL UNIQUE,
  "name" text NOT NULL,
  "isActive" boolean NOT NULL DEFAULT true,
  "providerType" text NOT NULL,
  "config" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "Lead" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "customerId" uuid NOT NULL REFERENCES "Customer"("id") ON DELETE CASCADE,
  "leadSourceId" uuid REFERENCES "LeadSource"("id") ON DELETE SET NULL,
  "externalRef" text,
  "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
  "firstName" text,
  "lastName" text,
  "companyName" text,
  "score" integer,
  "scoreReason" text,
  "sourcePayload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "firstSeenAt" timestamptz NOT NULL DEFAULT now(),
  "lastUpdatedAt" timestamptz NOT NULL DEFAULT now(),
  CHECK ("score" IS NULL OR ("score" >= 0 AND "score" <= 100))
);

CREATE TABLE "CampaignLead" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "campaignId" uuid NOT NULL REFERENCES "Campaign"("id") ON DELETE CASCADE,
  "leadId" uuid NOT NULL REFERENCES "Lead"("id") ON DELETE CASCADE,
  "enrolledAt" timestamptz NOT NULL DEFAULT now(),
  "removedAt" timestamptz,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE ("campaignId","leadId")
);

CREATE TABLE "Property" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "leadId" uuid NOT NULL REFERENCES "Lead"("id") ON DELETE CASCADE,
  "address1" text NOT NULL,
  "address2" text,
  "city" text NOT NULL,
  "state" text NOT NULL,
  "postalCode" text NOT NULL,
  "county" text,
  "propertyType" text,
  "yearBuilt" integer,
  "ownerOccupied" boolean,
  "estimatedValue" numeric(14,2),
  "attributes" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "Contact" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "leadId" uuid NOT NULL REFERENCES "Lead"("id") ON DELETE CASCADE,
  "type" "ContactType" NOT NULL,
  "value" text NOT NULL,
  "normalizedValue" text NOT NULL,
  "isPrimary" boolean NOT NULL DEFAULT false,
  "isValid" boolean,
  "carrier" text,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("leadId","type","normalizedValue")
);

CREATE TABLE "Consent" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "contactId" uuid NOT NULL REFERENCES "Contact"("id") ON DELETE CASCADE,
  "channel" "ConsentChannel" NOT NULL,
  "status" "ConsentStatus" NOT NULL DEFAULT 'UNKNOWN',
  "source" text,
  "evidence" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "grantedAt" timestamptz,
  "revokedAt" timestamptz,
  "expiresAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "Suppression" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "scope" "SuppressionScope" NOT NULL,
  "reason" "SuppressionReason" NOT NULL,
  "customerId" uuid REFERENCES "Customer"("id") ON DELETE CASCADE,
  "campaignId" uuid REFERENCES "Campaign"("id") ON DELETE CASCADE,
  "leadId" uuid REFERENCES "Lead"("id") ON DELETE CASCADE,
  "contactId" uuid REFERENCES "Contact"("id") ON DELETE CASCADE,
  "value" text,
  "notes" text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "expiresAt" timestamptz
);

CREATE TABLE "Conversation" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "campaignId" uuid NOT NULL REFERENCES "Campaign"("id") ON DELETE CASCADE,
  "leadId" uuid NOT NULL REFERENCES "Lead"("id") ON DELETE CASCADE,
  "contactId" uuid NOT NULL REFERENCES "Contact"("id") ON DELETE CASCADE,
  "channel" "ConversationChannel" NOT NULL,
  "status" "ConversationStatus" NOT NULL DEFAULT 'OPEN',
  "startedAt" timestamptz NOT NULL DEFAULT now(),
  "closedAt" timestamptz,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE "Message" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "conversationId" uuid NOT NULL REFERENCES "Conversation"("id") ON DELETE CASCADE,
  "contactId" uuid NOT NULL REFERENCES "Contact"("id") ON DELETE CASCADE,
  "provider" text,
  "providerMessageId" text,
  "direction" "MessageDirection" NOT NULL,
  "status" "MessageStatus" NOT NULL,
  "body" text NOT NULL,
  "sentAt" timestamptz,
  "receivedAt" timestamptz,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "Qualification" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "leadId" uuid NOT NULL REFERENCES "Lead"("id") ON DELETE CASCADE,
  "conversationId" uuid REFERENCES "Conversation"("id") ON DELETE SET NULL,
  "status" "QualificationStatus" NOT NULL DEFAULT 'PENDING',
  "answers" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "score" integer,
  "summary" text,
  "qualifiedAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CHECK ("score" IS NULL OR ("score" >= 0 AND "score" <= 100))
);

CREATE TABLE "Appointment" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "leadId" uuid NOT NULL REFERENCES "Lead"("id") ON DELETE CASCADE,
  "status" "AppointmentStatus" NOT NULL DEFAULT 'REQUESTED',
  "scheduledAt" timestamptz,
  "timezone" text NOT NULL DEFAULT 'America/New_York',
  "notes" text,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "Delivery" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "customerId" uuid NOT NULL REFERENCES "Customer"("id") ON DELETE CASCADE,
  "campaignId" uuid NOT NULL REFERENCES "Campaign"("id") ON DELETE CASCADE,
  "leadId" uuid NOT NULL REFERENCES "Lead"("id") ON DELETE CASCADE,
  "channel" text NOT NULL,
  "destination" text NOT NULL,
  "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "deliveredAt" timestamptz,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "ProviderJob" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "campaignId" uuid NOT NULL REFERENCES "Campaign"("id") ON DELETE CASCADE,
  "leadSourceId" uuid REFERENCES "LeadSource"("id") ON DELETE SET NULL,
  "provider" text NOT NULL,
  "jobType" text NOT NULL,
  "externalJobId" text,
  "status" "ProviderJobStatus" NOT NULL DEFAULT 'QUEUED',
  "input" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "output" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "error" text,
  "startedAt" timestamptz,
  "completedAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "Cost" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "customerId" uuid NOT NULL REFERENCES "Customer"("id") ON DELETE CASCADE,
  "campaignId" uuid REFERENCES "Campaign"("id") ON DELETE CASCADE,
  "leadId" uuid REFERENCES "Lead"("id") ON DELETE CASCADE,
  "leadSourceId" uuid REFERENCES "LeadSource"("id") ON DELETE SET NULL,
  "type" "CostType" NOT NULL,
  "provider" text,
  "amount" numeric(12,4) NOT NULL,
  "currency" text NOT NULL DEFAULT 'USD',
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  CHECK ("amount" >= 0)
);

CREATE TABLE "AuditEvent" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "customerId" uuid REFERENCES "Customer"("id") ON DELETE CASCADE,
  "campaignId" uuid REFERENCES "Campaign"("id") ON DELETE CASCADE,
  "leadId" uuid REFERENCES "Lead"("id") ON DELETE CASCADE,
  "userId" uuid REFERENCES "User"("id") ON DELETE SET NULL,
  "eventType" text NOT NULL,
  "actorType" text NOT NULL,
  "actorId" text,
  "data" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "Customer_status_idx" ON "Customer"("status");
CREATE INDEX "User_customerId_idx" ON "User"("customerId");
CREATE INDEX "User_role_isActive_idx" ON "User"("role","isActive");
CREATE INDEX "Campaign_customerId_status_idx" ON "Campaign"("customerId","status");
CREATE INDEX "Campaign_industry_status_idx" ON "Campaign"("industry","status");
CREATE INDEX "Territory_type_value_idx" ON "Territory"("type","value");
CREATE INDEX "Lead_customerId_status_idx" ON "Lead"("customerId","status");
CREATE INDEX "Lead_leadSourceId_externalRef_idx" ON "Lead"("leadSourceId","externalRef");
CREATE INDEX "Lead_score_idx" ON "Lead"("score");
CREATE INDEX "CampaignLead_leadId_idx" ON "CampaignLead"("leadId");
CREATE INDEX "Property_postalCode_idx" ON "Property"("postalCode");
CREATE INDEX "Property_county_state_idx" ON "Property"("county","state");
CREATE INDEX "Property_leadId_idx" ON "Property"("leadId");
CREATE INDEX "Contact_normalizedValue_idx" ON "Contact"("normalizedValue");
CREATE INDEX "Consent_contact_channel_status_idx" ON "Consent"("contactId","channel","status");
CREATE INDEX "Suppression_scope_reason_idx" ON "Suppression"("scope","reason");
CREATE INDEX "Suppression_customerId_idx" ON "Suppression"("customerId");
CREATE INDEX "Suppression_campaignId_idx" ON "Suppression"("campaignId");
CREATE INDEX "Suppression_leadId_idx" ON "Suppression"("leadId");
CREATE INDEX "Suppression_contactId_idx" ON "Suppression"("contactId");
CREATE INDEX "Suppression_value_idx" ON "Suppression"("value");
CREATE INDEX "Conversation_campaignId_status_idx" ON "Conversation"("campaignId","status");
CREATE INDEX "Conversation_leadId_idx" ON "Conversation"("leadId");
CREATE INDEX "Conversation_contactId_idx" ON "Conversation"("contactId");
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId","createdAt");
CREATE INDEX "Message_provider_providerMessageId_idx" ON "Message"("provider","providerMessageId");
CREATE INDEX "Message_contactId_idx" ON "Message"("contactId");
CREATE INDEX "Qualification_leadId_status_idx" ON "Qualification"("leadId","status");
CREATE INDEX "Qualification_conversationId_idx" ON "Qualification"("conversationId");
CREATE INDEX "Appointment_leadId_status_idx" ON "Appointment"("leadId","status");
CREATE INDEX "Appointment_scheduledAt_idx" ON "Appointment"("scheduledAt");
CREATE INDEX "Delivery_customerId_status_idx" ON "Delivery"("customerId","status");
CREATE INDEX "Delivery_campaignId_idx" ON "Delivery"("campaignId");
CREATE INDEX "Delivery_leadId_idx" ON "Delivery"("leadId");
CREATE INDEX "ProviderJob_campaignId_status_idx" ON "ProviderJob"("campaignId","status");
CREATE INDEX "ProviderJob_provider_externalJobId_idx" ON "ProviderJob"("provider","externalJobId");
CREATE INDEX "Cost_customerId_createdAt_idx" ON "Cost"("customerId","createdAt");
CREATE INDEX "Cost_campaignId_idx" ON "Cost"("campaignId");
CREATE INDEX "Cost_leadId_idx" ON "Cost"("leadId");
CREATE INDEX "AuditEvent_customerId_createdAt_idx" ON "AuditEvent"("customerId","createdAt");
CREATE INDEX "AuditEvent_campaignId_createdAt_idx" ON "AuditEvent"("campaignId","createdAt");
CREATE INDEX "AuditEvent_leadId_createdAt_idx" ON "AuditEvent"("leadId","createdAt");
CREATE INDEX "AuditEvent_eventType_createdAt_idx" ON "AuditEvent"("eventType","createdAt");