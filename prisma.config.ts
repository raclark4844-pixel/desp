import "dotenv/config";
import { defineConfig } from "prisma/config";

const migrationUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

if (!migrationUrl) {
  throw new Error("DIRECT_URL or DATABASE_URL must be configured for Prisma.");
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: migrationUrl,
  },
});
