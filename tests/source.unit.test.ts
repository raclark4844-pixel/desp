import test from "node:test";
import assert from "node:assert/strict";
import {
  BatchDataAdapter,
  buildBatchDataRequest,
  normalizeBatchData,
} from "../src/lib/lead-sources/adapters/batchdata";
import {
  propertyRecordSchema,
  SourceError,
  type SourceContext,
} from "../src/lib/lead-sources/contract";
import {
  matchesTarget,
  propertyIdentity,
  validateTargeting,
} from "../src/lib/lead-sources/normalization";
import { isAuthorizedInternalRequest } from "../src/lib/internal-auth";
import { boundedJson } from "../src/lib/lead-sources/http";
const c: SourceContext = {
  campaignId: "c",
  customerId: "u",
  industry: "roofing",
  desiredLeadCount: 25,
  residential: true,
  commercial: false,
  targetingConfig: { ownerOccupied: true, minYearBuilt: 1950 },
  territories: [{ type: "ZIP", value: "78704", state: "TX", county: null }],
};
const p = {
  address1: "101 Test St.",
  city: "Austin",
  state: "TX",
  postalCode: "78704",
  propertyType: "RESIDENTIAL" as const,
  ownerOccupied: true,
  yearBuilt: 1980,
};
const cursor = { territory: 0, skip: 0, pages: 0 };
test("canonical identity is provider independent and unit-sensitive", () => {
  assert.equal(
    propertyIdentity(p),
    propertyIdentity({ ...p, address1: " 101 TEST ST ", city: "AUSTIN" }),
  );
  assert.notEqual(
    propertyIdentity(p),
    propertyIdentity({ ...p, address2: "2" }),
  );
});
test("normalization accepts documented nested property response and rejects unknown fields", () => {
  const result = normalizeBatchData({
    id: "p1",
    address: {
      street: p.address1,
      city: p.city,
      state: "tx",
      zip: "78704-1234",
    },
    general: { propertyTypeCategory: "Residential", yearBuilt: 1980 },
    owner: { ownerOccupied: true },
  });
  assert.equal(result.postalCode, "78704");
  assert.equal(result.propertyType, "RESIDENTIAL");
  assert.throws(() => propertyRecordSchema.parse({ ...p, consent: "GRANTED" }));
});
test("territory, usage and all targeting filters fail closed", () => {
  assert.equal(matchesTarget(p, c), true);
  for (const change of [
    { postalCode: "10001" },
    { ownerOccupied: undefined },
    { propertyType: undefined },
    { yearBuilt: 1949 },
  ])
    assert.equal(matchesTarget({ ...p, ...change }, c), false);
  assert.throws(
    () =>
      validateTargeting({
        ...c,
        targetingConfig: { customCriteria: "arbitrary criteria" },
      }),
    /MANUAL_REVIEW/,
  );
  assert.throws(
    () => validateTargeting({ ...c, targetingConfig: { ethnicity: "x" } }),
    /UNSUPPORTED_TARGETING/,
  );
});
test("BatchData request is bounded and never forwards free text", () => {
  assert.deepEqual(buildBatchDataRequest(c, cursor, 100), {
    searchCriteria: { query: "78704" },
    options: { take: 100, skip: 0 },
  });
});
test("BatchData auth, response validation, pagination and error classification", async () => {
  process.env.BATCHDATA_API_KEY = "synthetic-test-key";
  let sent = false;
  const fetcher: typeof fetch = async (url, init) => {
    sent = true;
    assert.equal(
      String(url),
      "https://api.batchdata.com/api/v1/property/search",
    );
    assert.equal(init?.redirect, "error");
    assert.equal(
      new Headers(init?.headers).get("authorization"),
      "Bearer synthetic-test-key",
    );
    return Response.json({ results: { properties: [{}] } });
  };
  const a = new BatchDataAdapter(fetcher);
  const page = await a.fetchPage(c, cursor, 1);
  assert.equal(sent, true);
  assert.equal(page.nextCursor?.skip, 1);
  for (const [status, disposition] of [
    [401, "blocked"],
    [402, "blocked"],
    [429, "retry"],
    [503, "retry"],
    [400, "blocked"],
  ] as const) {
    await assert.rejects(
      new BatchDataAdapter(
        async () =>
          new Response("private provider payload", {
            status,
            headers: { "Retry-After": "120" },
          }),
      ).fetchPage(c, cursor, 100),
      (e: unknown) =>
        e instanceof SourceError &&
        e.disposition === disposition &&
        !e.message.includes("private"),
    );
  }
  await assert.rejects(
    new BatchDataAdapter(async () => Response.json({ bad: true })).fetchPage(
      c,
      cursor,
      100,
    ),
    /INVALID_PROVIDER_RESPONSE/,
  );
  delete process.env.BATCHDATA_API_KEY;
  await assert.rejects(a.fetchPage(c, cursor, 100), /API_KEY_MISSING/);
});
test("internal auth fails closed and body sizes are bounded", async () => {
  delete process.env.APS_INTERNAL_API_KEY;
  assert.equal(
    isAuthorizedInternalRequest(new Request("https://example.test")),
    false,
  );
  process.env.APS_INTERNAL_API_KEY = "test-secret";
  assert.equal(
    isAuthorizedInternalRequest(
      new Request("https://example.test", {
        headers: { "x-aps-internal-key": "wrong" },
      }),
    ),
    false,
  );
  assert.equal(
    isAuthorizedInternalRequest(
      new Request("https://example.test", {
        headers: { "x-aps-internal-key": "test-secret" },
      }),
    ),
    true,
  );
  await assert.rejects(
    boundedJson(
      new Request("https://example.test", {
        method: "POST",
        body: "x".repeat(262145),
      }),
    ),
    /BODY_TOO_LARGE/,
  );
});
