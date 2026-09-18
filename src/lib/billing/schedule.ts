export const BILLING_ZONE = "America/New_York";
export const UNIT_CENTS = 6000;
// Most recent end-of-Friday cutoff, including daylight-saving changes.
export function weeklyCutoff(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BILLING_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (k: string) => Number(parts.find((p) => p.type === k)!.value);
  const day = new Date(Date.UTC(get("year"), get("month") - 1, get("day")));
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() - 6 + 7) % 7));
  const offset = new Intl.DateTimeFormat("en-US", {
    timeZone: BILLING_ZONE,
    timeZoneName: "shortOffset",
  })
    .formatToParts(new Date(day.getTime() + 12 * 3600000))
    .find((p) => p.type === "timeZoneName")!.value;
  const hours = Number(offset.replace("GMT", ""));
  return new Date(day.getTime() - hours * 3600000);
}
export const usd = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    cents / 100,
  );
