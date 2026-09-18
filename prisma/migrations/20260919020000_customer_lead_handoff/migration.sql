-- AlterTable
ALTER TABLE "NotificationTarget" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'EMPLOYEE',
ADD COLUMN     "name" TEXT,
ALTER COLUMN "employeeId" DROP NOT NULL;

