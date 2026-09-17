// Presence only: never emit credential values or connection strings.
for (const name of ["DATABASE_URL", "APS_INTERNAL_API_KEY", "BATCHDATA_API_KEY", "CRON_SECRET"]) {
  console.log(`[source-config] ${name}: ${process.env[name]?.trim() ? "configured" : "missing"}`);
}
