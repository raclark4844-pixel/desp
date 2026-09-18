import { z } from "zod";
import { asRecord, SourceError } from "../lead-sources/contract";

export const lookupSchema = z
  .object({
    leadId: z.string().uuid(),
    propertyId: z.string().uuid(),
    street: z.string().trim().min(1).max(320),
    city: z.string().trim().min(1).max(120),
    state: z.string().regex(/^[A-Z]{2}$/),
    zip: z.string().regex(/^\d{5}(-\d{4})?$/),
  })
  .strict();
export type Lookup = z.infer<typeof lookupSchema>;
export type EnrichedContact = {
  type: "MOBILE" | "LANDLINE" | "EMAIL" | "OTHER";
  value: string;
  dnc: boolean;
  restricted: boolean;
};
export interface EnrichmentResult {
  contacts: EnrichedContact[];
  rejected: number;
  matched: boolean;
}
export interface EnrichmentAdapter {
  lookup(input: Lookup, requestId: string): Promise<EnrichmentResult>;
}
export function enrichmentEnabled() {
  return process.env.APS_ENRICHMENT_ENABLED === "true";
}
export function buildLookup(input: Lookup, requestId: string) {
  return {
    requests: [
      {
        address: {
          street: input.street,
          city: input.city,
          state: input.state,
          zip: input.zip,
        },
        requestId,
      },
    ],
    options: { skipTrace: true, datasets: ["basic", "contact"] },
  };
}
export function normalizeContacts(raw: unknown): EnrichmentResult {
  const owner = asRecord(raw);
  // Omitted fields are not interpreted as consent, verification or permission.
  const phones = owner.phoneNumbers ?? [],
    legacyEmails = owner.emails ?? [],
    enrichedEmails = owner.enrichedEmails ?? [];
  if (
    !Array.isArray(legacyEmails) ||
    !Array.isArray(enrichedEmails) ||
    enrichedEmails.length > 20
  )
    throw new SourceError("INVALID_CONTACT_RESPONSE", "blocked");
  const emails = [
    ...legacyEmails,
    ...enrichedEmails.map((e) => asRecord(e).email),
  ];
  if (
    !Array.isArray(phones) ||
    !Array.isArray(emails) ||
    phones.length > 20 ||
    emails.length > 20
  )
    throw new SourceError("INVALID_CONTACT_RESPONSE", "blocked");
  const contacts = new Map<string, EnrichedContact>();
  let rejected = 0;
  for (const item of phones) {
    const p = asRecord(item);
    const digits =
      typeof p.number === "string" ? p.number.replace(/[\s()+.-]/g, "") : "";
    const national =
      digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
    if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(national)) {
      rejected++;
      continue;
    }
    const value = `+1${national}`;
    const type =
      p.type === "Mobile"
        ? "MOBILE"
        : p.type === "Land Line"
          ? "LANDLINE"
          : "OTHER";
    const prior = contacts.get(value);
    contacts.set(value, {
      type: prior?.type ?? type,
      value,
      dnc: prior?.dnc === true || p.dnc === true,
      restricted: prior?.restricted === true || p.tcpa === true,
    });
  }
  for (const item of emails) {
    const value = typeof item === "string" ? item.trim().toLowerCase() : "";
    if (value.length > 254 || !z.email().safeParse(value).success) {
      rejected++;
      continue;
    }
    contacts.set(value, {
      type: "EMAIL",
      value,
      dnc: false,
      restricted: false,
    });
  }
  return { contacts: [...contacts.values()], rejected, matched: true };
}
export class BatchDataEnrichmentAdapter implements EnrichmentAdapter {
  constructor(private fetcher: typeof fetch = fetch) {}
  async lookup(input: Lookup, requestId: string): Promise<EnrichmentResult> {
    if (!enrichmentEnabled())
      throw new SourceError("ENRICHMENT_DISABLED", "blocked");
    const key = process.env.BATCHDATA_ENRICHMENT_API_KEY?.trim();
    if (!key) throw new SourceError("ENRICHMENT_KEY_MISSING", "blocked");
    let response: Response;
    try {
      response = await this.fetcher(
        "https://api.batchdata.com/api/v1/property/lookup/all-attributes",
        {
          method: "POST",
          redirect: "error",
          cache: "no-store",
          signal: AbortSignal.timeout(15000),
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(
            buildLookup(lookupSchema.parse(input), requestId),
          ),
        },
      );
    } catch {
      throw new SourceError("PROVIDER_OUTCOME_UNKNOWN", "blocked");
    }
    if ([401, 403].includes(response.status))
      throw new SourceError("ENRICHMENT_CREDENTIALS_REJECTED", "blocked");
    if (response.status === 402)
      throw new SourceError("BATCHDATA_CREDITS_REQUIRED", "blocked");
    if (response.status === 429) {
      const header = response.headers.get("retry-after") ?? "";
      const delay = /^\d+$/.test(header)
        ? Number(header)
        : (Date.parse(header) - Date.now()) / 1000;
      throw new SourceError(
        "PROVIDER_RATE_LIMIT",
        "retry",
        Number.isFinite(delay) ? Math.max(0, Math.min(3600, delay)) : 0,
      );
    }
    // 5xx/timeout may follow a billable request: never repeat automatically.
    if (!response.ok)
      throw new SourceError(`PROVIDER_HTTP_${response.status}`, "blocked");
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new SourceError("INVALID_PROVIDER_RESPONSE", "blocked");
    }
    const root = asRecord(payload),
      result = asRecord(root.results);
    if (
      asRecord(root.status).code !== 200 ||
      (Array.isArray(result.warnings) && result.warnings.length) ||
      (Array.isArray(root.warnings) && root.warnings.length)
    )
      throw new SourceError("PROVIDER_RESPONSE_REVIEW_REQUIRED", "blocked");
    if (!Array.isArray(result.properties) || result.properties.length > 1)
      throw new SourceError("AMBIGUOUS_PROPERTY_RESPONSE", "blocked");
    if (!result.properties.length)
      return { contacts: [], rejected: 0, matched: false };
    const property = asRecord(result.properties[0]);
    if (asRecord(property.meta).requestId !== requestId)
      throw new SourceError("RESPONSE_CORRELATION_MISMATCH", "blocked");
    // Persist only normalized phone/email candidates. Never store raw owner,
    // demographic, financial, household or other unrelated enrichment fields.
    if (
      !property.owner ||
      typeof property.owner !== "object" ||
      Array.isArray(property.owner)
    )
      throw new SourceError("CONTACT_DATA_MISSING", "blocked");
    return normalizeContacts(property.owner);
  }
}
