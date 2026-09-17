import {
  asRecord,
  propertyRecordSchema,
  SourceError,
  type LeadSourceAdapter,
  type SourceContext,
  type SourceCursor,
} from "../contract";
import { validateTargeting } from "../normalization";

export function buildBatchDataRequest(
  context: SourceContext,
  cursor: SourceCursor,
  take: number,
) {
  validateTargeting(context);
  const territory = context.territories[cursor.territory];
  if (!territory) throw new SourceError("INVALID_CURSOR", "failed");
  const query = [
    territory.value,
    territory.type === "COUNTY" && !/county$/i.test(territory.value)
      ? "County"
      : "",
    ["CITY", "COUNTY"].includes(territory.type) ? territory.state : "",
  ]
    .filter(Boolean)
    .join(" ");
  // Provider receives geography only. APS applies every supported property filter
  // to normalized records before ingestion; unknown attributes fail closed.
  return { searchCriteria: { query }, options: { take, skip: cursor.skip } };
}
const optionalText = (v: unknown) =>
  typeof v === "string" && v.trim() ? v.trim() : undefined;
const optionalNumber = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;
export function normalizeBatchData(raw: unknown) {
  const row = asRecord(raw),
    address = asRecord(row.address),
    general = asRecord(row.general);
  const valuation = asRecord(row.valuation),
    owner = asRecord(row.owner),
    building = asRecord(row.building);
  const category =
    optionalText(general.propertyTypeCategory)?.toUpperCase() ??
    optionalText(general.propertyType)?.toUpperCase();
  const residential = [
    "RESIDENTIAL",
    "SINGLE FAMILY",
    "MULTI FAMILY",
    "CONDOMINIUM",
    "TOWNHOUSE",
    "MOBILE HOME",
  ].includes(category ?? "");
  const commercial = ["COMMERCIAL", "INDUSTRIAL", "OFFICE", "RETAIL"].includes(
    category ?? "",
  );
  return propertyRecordSchema.parse({
    externalRef:
      typeof row.id === "number" ? String(row.id) : optionalText(row.id),
    address1: address.street,
    address2: optionalText(address.street2),
    city: address.city,
    state: address.state,
    postalCode: address.zip,
    county: optionalText(address.county),
    propertyType: residential
      ? "RESIDENTIAL"
      : commercial
        ? "COMMERCIAL"
        : undefined,
    yearBuilt:
      optionalNumber(building.yearBuilt) ?? optionalNumber(general.yearBuilt),
    ownerOccupied:
      typeof owner.ownerOccupied === "boolean"
        ? owner.ownerOccupied
        : undefined,
    estimatedValue: optionalNumber(valuation.estimatedValue),
  });
}
export class BatchDataAdapter implements LeadSourceAdapter {
  key = "BATCHDATA";
  constructor(private fetcher: typeof fetch = fetch) {}
  normalize = normalizeBatchData;
  async fetchPage(context: SourceContext, cursor: SourceCursor, take: number) {
    const token = process.env.BATCHDATA_API_KEY?.trim();
    if (!token) throw new SourceError("BATCHDATA_API_KEY_MISSING", "blocked");
    const body = buildBatchDataRequest(context, cursor, take);
    let response: Response;
    try {
      response = await this.fetcher(
        "https://api.batchdata.com/api/v1/property/search",
        {
          method: "POST",
          redirect: "error",
          cache: "no-store",
          signal: AbortSignal.timeout(15000),
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(body),
        },
      );
    } catch {
      throw new SourceError("PROVIDER_NETWORK_ERROR", "retry");
    }
    if (response.status === 401 || response.status === 403)
      throw new SourceError("BATCHDATA_CREDENTIALS_REJECTED", "blocked");
    if (response.status === 402)
      throw new SourceError("BATCHDATA_CREDITS_REQUIRED", "blocked");
    if (response.status === 429 || response.status >= 500) {
      const header = response.headers.get("retry-after") ?? "";
      const seconds = /^\d+$/.test(header)
        ? Number(header)
        : Math.ceil((Date.parse(header) - Date.now()) / 1000);
      throw new SourceError(
        `PROVIDER_HTTP_${response.status}`,
        "retry",
        Number.isFinite(seconds) ? Math.max(0, Math.min(seconds, 3600)) : 0,
      );
    }
    if (!response.ok)
      throw new SourceError(`PROVIDER_HTTP_${response.status}`, "blocked");
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new SourceError("INVALID_PROVIDER_RESPONSE", "failed");
    }
    const providerStatus = asRecord(asRecord(payload).status).code;
    if (providerStatus != null && providerStatus !== 200)
      throw new SourceError("PROVIDER_APPLICATION_ERROR", "blocked");
    const records = asRecord(asRecord(payload).results).properties;
    if (!Array.isArray(records) || records.length > take)
      throw new SourceError("INVALID_PROVIDER_RESPONSE", "failed");
    const nextTerritory = cursor.territory + 1;
    const exhausted = records.length < take;
    const nextCursor =
      exhausted && nextTerritory >= context.territories.length
        ? null
        : {
            territory: exhausted ? nextTerritory : cursor.territory,
            skip: exhausted ? 0 : cursor.skip + records.length,
            pages: cursor.pages + 1,
          };
    return { records, nextCursor };
  }
}
