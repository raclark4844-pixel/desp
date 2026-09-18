CREATE TABLE "Employee" (
 "id" UUID NOT NULL, "username" TEXT NOT NULL, "email" TEXT NOT NULL, "name" TEXT NOT NULL,
 "passwordHash" TEXT NOT NULL, "isAdmin" BOOLEAN NOT NULL DEFAULT false,
 "isActive" BOOLEAN NOT NULL DEFAULT true, "mustChangePassword" BOOLEAN NOT NULL DEFAULT true,
 "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(6) NOT NULL,
 CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Employee_username_key" ON "Employee"("username");
CREATE UNIQUE INDEX "Employee_email_key" ON "Employee"("email");
CREATE TABLE "EmployeeSession" (
 "tokenHash" TEXT NOT NULL, "employeeId" UUID NOT NULL, "expiresAt" TIMESTAMPTZ(6) NOT NULL,
 CONSTRAINT "EmployeeSession_pkey" PRIMARY KEY ("tokenHash"),
 CONSTRAINT "EmployeeSession_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "EmployeeSession_employeeId_idx" ON "EmployeeSession"("employeeId");
CREATE INDEX "EmployeeSession_expiresAt_idx" ON "EmployeeSession"("expiresAt");
CREATE TABLE "LoginAttempt" (
 "key" TEXT NOT NULL, "attempts" INTEGER NOT NULL DEFAULT 1,
 "windowAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "LoginAttempt_pkey" PRIMARY KEY ("key")
);
