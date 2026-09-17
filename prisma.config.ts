import "dotenv/config";
import { defineConfig } from "prisma/config";

// Prisma code generation/validation does not need a live database connection.
// Vercel runs `prisma generate` during dependency installation, before some
// project environments may be available. Use a local-only placeholder for
// build-time generation, while application runtime still requires DATABASE_URL.
const migrationUrl =
  process.env.DIRECT_URL ??
  process.env.DATABASE_URL ??
  "postgresql://user:password@localhost:5432/aps_lead_engine";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: migrationUrl,
  },
});
