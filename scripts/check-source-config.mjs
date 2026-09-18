// Presence only: never emit credential values or connection strings.
for (const name of ["DATABASE_URL", "APS_INTERNAL_API_KEY", "BATCHDATA_API_KEY", "CRON_SECRET", "BATCHDATA_ENRICHMENT_API_KEY"]) {
  console.log(`[source-config] ${name}: ${process.env[name]?.trim() ? "configured" : "missing"}`);
}

console.log(`[enrichment] execution: ${process.env.APS_ENRICHMENT_ENABLED === "true" ? "enabled" : "disabled"}`);
