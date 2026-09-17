import { createHash } from "node:crypto";
import {
  asRecord,
  type PropertyRecord,
  type SourceContext,
  SourceError,
} from "./contract";
const canonical = (v: string) =>
  v
    .normalize("NFKC")
    .trim()
    .toUpperCase()
    .replace(/[.,]/g, "")
    .replace(/\s+/g, " ");
export function propertyIdentity(p: PropertyRecord) {
  return createHash("sha256")
    .update(
      [p.address1, p.address2 ?? "", p.city, p.state, p.postalCode.slice(0, 5)]
        .map(canonical)
        .join("|"),
    )
    .digest("hex");
}
export function validateTargeting(c: SourceContext) {
  const t = asRecord(c.targetingConfig);
  // Free text is not a safe executable filter. Never send it to a provider or silently ignore it.
  if (t.customCriteria || t.leadType)
    throw new SourceError("TARGETING_REQUIRES_MANUAL_REVIEW", "blocked");
  const allowed = new Set([
    "industryProfile",
    "recommendedCriteria",
    "prohibitedTargetingNotice",
    "ownerOccupied",
    "minYearBuilt",
    "maxYearBuilt",
    "minEstimatedValue",
    "maxEstimatedValue",
    "leadType",
    "customCriteria",
  ]);
  if (Object.keys(t).some((k) => !allowed.has(k)))
    throw new SourceError("UNSUPPORTED_TARGETING", "blocked");
  if (
    !c.territories.length ||
    c.territories.some(
      (t) =>
        !["ZIP", "CITY", "COUNTY", "STATE"].includes(t.type) ||
        ((t.type === "CITY" || t.type === "COUNTY") &&
          !/^[A-Za-z]{2}$/.test(t.state ?? "")) ||
        (t.type === "ZIP" && !/^\d{5}$/.test(t.value)) ||
        (t.type === "STATE" && !/^[A-Za-z]{2}$/.test(t.value)),
    )
  )
    throw new SourceError("INVALID_TERRITORY", "blocked");
  if (t.ownerOccupied != null && typeof t.ownerOccupied !== "boolean")
    throw new SourceError("INVALID_TARGETING", "blocked");
  for (const key of [
    "minYearBuilt",
    "maxYearBuilt",
    "minEstimatedValue",
    "maxEstimatedValue",
  ])
    if (
      t[key] != null &&
      (typeof t[key] !== "number" ||
        !Number.isFinite(t[key]) ||
        Number(t[key]) < 0)
    )
      throw new SourceError("INVALID_TARGETING", "blocked");
  for (const [min, max] of [
    ["minYearBuilt", "maxYearBuilt"],
    ["minEstimatedValue", "maxEstimatedValue"],
  ])
    if (t[min] != null && t[max] != null && Number(t[min]) > Number(t[max]))
      throw new SourceError("INVALID_TARGETING", "blocked");
}
export function matchesTarget(p: PropertyRecord, c: SourceContext): boolean {
  const inTerritory = c.territories.some((t) => {
    if (t.type === "ZIP") return p.postalCode === t.value;
    if (t.type === "STATE") return p.state === canonical(t.value);
    if (p.state !== canonical(t.state ?? "")) return false;
    if (t.type === "CITY") return canonical(p.city) === canonical(t.value);
    return (
      canonical(p.county ?? "").replace(/ COUNTY$/, "") ===
      canonical(t.value).replace(/ COUNTY$/, "")
    );
  });
  if (!inTerritory || (!c.residential && !c.commercial)) return false;
  if (
    !(c.residential && c.commercial) &&
    p.propertyType !== (c.residential ? "RESIDENTIAL" : "COMMERCIAL")
  )
    return false;
  const t = asRecord(c.targetingConfig);
  if (
    typeof t.ownerOccupied === "boolean" &&
    p.ownerOccupied !== t.ownerOccupied
  )
    return false;
  for (const [key, value, lower] of [
    ["minYearBuilt", p.yearBuilt, true],
    ["maxYearBuilt", p.yearBuilt, false],
    ["minEstimatedValue", p.estimatedValue, true],
    ["maxEstimatedValue", p.estimatedValue, false],
  ] as const) {
    const bound = t[key];
    if (
      typeof bound === "number" &&
      (value == null || (lower ? value < bound : value > bound))
    )
      return false;
  }
  return true;
}
