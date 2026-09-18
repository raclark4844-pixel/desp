-- CreateTable
CREATE TABLE "BillingConfig" (
    "id" TEXT NOT NULL DEFAULT 'main',
    "thirdEmail" TEXT,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "BillingConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingPreference" (
    "customerId" UUID NOT NULL,
    "email" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "BillingPreference_pkey" PRIMARY KEY ("customerId")
);

-- CreateTable
CREATE TABLE "BillingInvoice" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "cutoff" TIMESTAMPTZ(6) NOT NULL,
    "customerName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'READY',
    "recipients" TEXT[],
    "unitCents" INTEGER NOT NULL DEFAULT 6000,
    "totalCents" INTEGER NOT NULL,
    "sentAt" TIMESTAMPTZ(6),
    "providerId" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "BillingInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingInvoiceLine" (
    "id" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "notificationId" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "campaignName" TEXT NOT NULL,
    "leadId" UUID NOT NULL,
    "summary" TEXT NOT NULL,
    "sentAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "BillingInvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BillingInvoice_number_key" ON "BillingInvoice"("number");

-- CreateIndex
CREATE UNIQUE INDEX "BillingInvoice_providerId_key" ON "BillingInvoice"("providerId");

-- CreateIndex
CREATE INDEX "BillingInvoice_status_createdAt_idx" ON "BillingInvoice"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BillingInvoice_customerId_cutoff_key" ON "BillingInvoice"("customerId", "cutoff");

-- CreateIndex
CREATE UNIQUE INDEX "BillingInvoiceLine_notificationId_key" ON "BillingInvoiceLine"("notificationId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingInvoiceLine_campaignId_leadId_key" ON "BillingInvoiceLine"("campaignId", "leadId");

-- AddForeignKey
ALTER TABLE "BillingPreference" ADD CONSTRAINT "BillingPreference_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingInvoice" ADD CONSTRAINT "BillingInvoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingInvoiceLine" ADD CONSTRAINT "BillingInvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "BillingInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

