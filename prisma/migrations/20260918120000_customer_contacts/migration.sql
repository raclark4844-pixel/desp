-- Business contacts are separate from portal login identities.
ALTER TABLE "Customer" ADD COLUMN "contactName" TEXT, ADD COLUMN "contactEmail" TEXT;
UPDATE "Customer" c SET "contactName" = u.name, "contactEmail" = u.email
FROM (SELECT DISTINCT ON ("customerId") "customerId", name, email
      FROM "User" WHERE "customerId" IS NOT NULL AND "isActive" = true AND role = 'CUSTOMER_ADMIN'
      ORDER BY "customerId", "createdAt", id) u
WHERE c.id = u."customerId";
