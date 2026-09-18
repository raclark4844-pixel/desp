import test from "node:test";
import assert from "node:assert/strict";
import {
  BatchDataEnrichmentAdapter,
  buildLookup,
  normalizeContacts,
  type Lookup,
} from "../src/lib/enrichment/adapter";
import { SourceError } from "../src/lib/lead-sources/contract";
import { POST as queueRoute } from "../src/app/api/internal/enrichment/jobs/route";
import { POST as workerRoute } from "../src/app/api/internal/enrichment/worker/route";
const input: Lookup = {
  leadId: "00000000-0000-4000-8000-000000000001",
  propertyId: "00000000-0000-4000-8000-000000000002",
  street: "101 Synthetic Street",
  city: "Austin",
  state: "TX",
  zip: "78704",
};
test("enrichment endpoints deny unauthenticated requests before parsing or database work", async () => {
  const old = process.env.APS_INTERNAL_API_KEY;
  delete process.env.APS_INTERNAL_API_KEY;
  try {
    for (const route of [queueRoute, workerRoute]) {
      assert.equal(
        (
          await route(
            new Request("https://example.invalid", {
              method: "POST",
              body: "bad",
            }),
          )
        ).status,
        401,
      );
    }
  } finally {
    if (old === undefined) delete process.env.APS_INTERNAL_API_KEY;
    else process.env.APS_INTERNAL_API_KEY = old;
  }
});
test("contact allowlist, normalization, deduplication and restrictive flags", () => {
  const result = normalizeContacts({
    phoneNumbers: [
      { number: "(202) 555-0101", type: "Mobile" },
      { number: "12025550101", type: "Land Line", dnc: true, tcpa: true },
      { number: "bad" },
    ],
    emails: ["TEST@example.invalid", "bad"],
    enrichedEmails: [{ email: "test@example.invalid", tested: true }],
    demographics: { religion: "discard" },
    name: "discard",
  });
  assert.equal(result.contacts.length, 2);
  assert.equal(result.rejected, 2);
  assert.deepEqual(result.contacts[0], {
    type: "MOBILE",
    value: "+12025550101",
    dnc: true,
    restricted: true,
  });
  assert.equal(result.contacts[1].value, "test@example.invalid");
  assert.equal(JSON.stringify(result).includes("discard"), false);
  assert.throws(() => normalizeContacts({ phoneNumbers: {} }));
});
test("lookup requests only Basic and Contact datasets with correlation", () => {
  const body = buildLookup(input, "request-1");
  assert.deepEqual(body.options, {
    skipTrace: true,
    datasets: ["basic", "contact"],
  });
  assert.equal(body.requests[0].requestId, "request-1");
  assert.equal(JSON.stringify(body).includes(input.leadId), false);
});
test("adapter gates paid traffic, validates correlation and classifies failures", async () => {
  const oldEnabled = process.env.APS_ENRICHMENT_ENABLED,
    oldKey = process.env.BATCHDATA_ENRICHMENT_API_KEY;
  let calls = 0;
  let status = 200;
  let payload: unknown = {
    status: { code: 200 },
    results: {
      properties: [
        {
          meta: { requestId: "r1" },
          owner: { emails: ["test@example.invalid"] },
        },
      ],
    },
  };
  const fetcher: typeof fetch = async (url, options) => {
    calls++;
    assert.equal(
      String(url),
      "https://api.batchdata.com/api/v1/property/lookup/all-attributes",
    );
    assert.equal(options?.redirect, "error");
    return Response.json(payload, { status });
  };
  const adapter = new BatchDataEnrichmentAdapter(fetcher);
  try {
    delete process.env.APS_ENRICHMENT_ENABLED;
    await assert.rejects(adapter.lookup(input, "r1"), /ENRICHMENT_DISABLED/);
    assert.equal(calls, 0);
    process.env.APS_ENRICHMENT_ENABLED = "true";
    delete process.env.BATCHDATA_ENRICHMENT_API_KEY;
    await assert.rejects(adapter.lookup(input, "r1"), /ENRICHMENT_KEY_MISSING/);
    assert.equal(calls, 0);
    process.env.BATCHDATA_ENRICHMENT_API_KEY = "synthetic-test-key";
    assert.equal((await adapter.lookup(input, "r1")).contacts.length, 1);
    await assert.rejects(
      adapter.lookup(input, "wrong"),
      /CORRELATION_MISMATCH/,
    );
    payload = { status: { code: 200 }, results: { properties: [] } };
    assert.equal((await adapter.lookup(input, "r1")).matched, false);
    payload = {
      status: { code: 200 },
      results: { properties: [], warnings: [{}] },
    };
    await assert.rejects(adapter.lookup(input, "r1"), /REVIEW_REQUIRED/);
    for (const code of [401, 402, 403, 500]) {
      status = code;
      await assert.rejects(
        adapter.lookup(input, "r1"),
        (e) => e instanceof SourceError && e.disposition === "blocked",
      );
    }
    status = 429;
    await assert.rejects(
      adapter.lookup(input, "r1"),
      (e) => e instanceof SourceError && e.disposition === "retry",
    );
    await assert.rejects(
      new BatchDataEnrichmentAdapter(async () => {
        throw new Error("secret upstream details");
      }).lookup(input, "r1"),
      /PROVIDER_OUTCOME_UNKNOWN/,
    );
  } finally {
    if (oldEnabled === undefined) delete process.env.APS_ENRICHMENT_ENABLED;
    else process.env.APS_ENRICHMENT_ENABLED = oldEnabled;
    if (oldKey === undefined) delete process.env.BATCHDATA_ENRICHMENT_API_KEY;
    else process.env.BATCHDATA_ENRICHMENT_API_KEY = oldKey;
  }
});
