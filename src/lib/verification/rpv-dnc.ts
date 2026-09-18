import { z } from "zod";
import { SourceError, asRecord } from "../lead-sources/contract";

const phoneSchema = z.string().regex(/^\+1[2-9]\d{2}[2-9]\d{6}$/);
// Future workers must load this from trusted seller authorization records,
// never accept it as an assertion from a public request or share it across clients.
export const dncAuthorizationSchema = z
  .object({
    customerId: z.string().uuid(),
    san: z.string().trim().min(1).max(100),
    organizationId: z.string().trim().min(1).max(100),
    expiresAt: z.iso.datetime(),
    areaCodes: z
      .array(z.string().regex(/^[2-9]\d{2}$/))
      .min(1)
      .max(1000),
    providerAccountConfirmed: z.literal(true),
  })
  .strict();
export type DncAuthorization = z.infer<typeof dncAuthorizationSchema>;
export type DncResult = {
  provider: "REALPHONEVALIDATION";
  outcome: "PASS" | "FAIL" | "UNKNOWN";
  national: "Y" | "N" | "?";
  state: "Y" | "N" | "?";
  dma: "Y" | "N" | "?";
  litigator: "Y" | "N" | "?";
  providerRecordId: string | null;
  // DNC evidence alone never changes consent, lead eligibility or permissions.
  outreachAllowed: false;
};
export interface DncAdapter {
  lookup(
    customerId: string,
    normalizedPhone: string,
    authorization: DncAuthorization,
  ): Promise<DncResult>;
}
const flag = z.enum(["Y", "N", "?"]);
export function normalizeDncResponse(
  raw: unknown,
  expectedPhone: string,
): DncResult {
  const data = asRecord(raw);
  const code = String(data.RESPONSECODE ?? "");
  if (code === "unauthorized")
    throw new SourceError("RPV_CREDENTIALS_REJECTED", "blocked");
  if (code === "102")
    throw new SourceError("RPV_ACCOUNT_OR_BALANCE_REQUIRED", "blocked");
  if (code === "-1" || code === "invalid-phone")
    throw new SourceError("RPV_PHONE_REJECTED", "blocked");
  if (code !== "OK") throw new SourceError("RPV_RESPONSE_INVALID", "blocked");
  // The documented example omits the phone. If supplied, it must match.
  for (const name of ["Phone", "phone"]) {
    if (data[name] !== undefined && data[name] !== expectedPhone)
      throw new SourceError("RPV_RESPONSE_MISMATCH", "blocked");
  }
  const readFlag = (name: string) =>
    flag.safeParse(data[name]).success
      ? flag.parse(data[name])
      : ("?" as const);
  const national = readFlag("national_dnc"),
    state = readFlag("state_dnc"),
    dma = readFlag("dma"),
    litigator = readFlag("litigator");
  const flags = [national, state, dma, litigator];
  const id = data.id ?? data.ID;
  return {
    provider: "REALPHONEVALIDATION",
    outcome: flags.includes("Y")
      ? "FAIL"
      : flags.every((f) => f === "N")
        ? "PASS"
        : "UNKNOWN",
    national,
    state,
    dma,
    litigator,
    providerRecordId:
      typeof id === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(id) ? id : null,
    outreachAllowed: false,
  };
}
async function boundedResponse(response: Response) {
  const max = 32768;
  if (Number(response.headers.get("content-length") ?? 0) > max) {
    await response.body?.cancel();
    throw new SourceError("RPV_RESPONSE_TOO_LARGE", "blocked");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new SourceError("RPV_RESPONSE_INVALID", "blocked");
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) {
        await reader.cancel();
        throw new SourceError("RPV_RESPONSE_TOO_LARGE", "blocked");
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch (e) {
    if (e instanceof SourceError) throw e;
    throw new SourceError("RPV_RESPONSE_INVALID", "blocked");
  } finally {
    reader.releaseLock();
  }
}
export class RealPhoneValidationDncAdapter implements DncAdapter {
  constructor(private fetcher: typeof fetch = fetch) {}
  async lookup(
    customerId: string,
    normalizedPhone: string,
    authorization: DncAuthorization,
  ): Promise<DncResult> {
    if (process.env.APS_RPV_DNC_ENABLED !== "true")
      throw new SourceError("RPV_DNC_DISABLED", "blocked");
    const key = process.env.RPV_API_TOKEN?.trim();
    if (!key) throw new SourceError("RPV_KEY_MISSING", "blocked");
    const auth = dncAuthorizationSchema.safeParse(authorization);
    const phone = phoneSchema.safeParse(normalizedPhone);
    if (
      !auth.success ||
      !phone.success ||
      auth.data.customerId !== customerId ||
      Date.parse(auth.data.expiresAt) <= Date.now() ||
      !auth.data.areaCodes.includes(normalizedPhone.slice(2, 5))
    )
      throw new SourceError("RPV_AUTHORIZATION_REQUIRED", "blocked");
    let response: Response;
    try {
      response = await this.fetcher(
        "https://api.realvalidation.com/rpvWebService/DNCLookup.php",
        {
          method: "POST",
          redirect: "error",
          cache: "no-store",
          signal: AbortSignal.timeout(15000),
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
          body: new URLSearchParams({
            phone: normalizedPhone.slice(2),
            token: key,
            output: "json",
          }).toString(),
        },
      );
    } catch {
      throw new SourceError("RPV_OUTCOME_UNKNOWN", "blocked");
    }
    if (!response.ok) {
      await response.body?.cancel();
      // Vendor documents HTTP 403 for throttling; do not misclassify as credentials.
      // All errors require review: no automatic retry of potentially paid lookups.
      if ([403, 429].includes(response.status))
        throw new SourceError("RPV_RATE_LIMIT_OR_ACCESS_DENIED", "blocked");
      if (response.status === 401)
        throw new SourceError("RPV_CREDENTIALS_REJECTED", "blocked");
      throw new SourceError("RPV_HTTP_FAILURE", "blocked");
    }
    return normalizeDncResponse(
      await boundedResponse(response),
      normalizedPhone.slice(2),
    );
  }
}
