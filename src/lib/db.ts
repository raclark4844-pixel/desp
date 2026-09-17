import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

const runtimeConnectionString = process.env.DATABASE_URL;

// Next.js evaluates route modules during production builds. Use a local-only
// placeholder so compilation can complete even when build-time env injection is
// unavailable. Runtime database calls remain gated by databaseConfigured.
const connectionString =
  runtimeConnectionString ??
  "postgresql://user:password@127.0.0.1:5432/aps_lead_engine";

export const databaseConfigured = Boolean(runtimeConnectionString);

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

const adapter = new PrismaPg({ connectionString });

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
