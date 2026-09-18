import test from "node:test";
import assert from "node:assert/strict";
import {
  RealPhoneValidationDncAdapter,
  normalizeDncResponse,
  type DncAuthorization,
} from "../src/lib/verification/rpv-dnc";
const good = {
  RESPONSECODE: "OK",
  RESPONSEMSG: {},
  national_dnc: "N",
  state_dnc: "N",
  dma: "N",
  litigator: "N",
  iscell: "Y",
  id: "test-1",
};
const customerId = "00000000-0000-4000-8000-000000000001";
const auth = (): DncAuthorization => ({
  customerId,
  san: "synthetic-san",
  organizationId: "synthetic-org",
  expiresAt: new Date(Date.now() + 86400000).toISOString(),
  areaCodes: ["202"],
  providerAccountConfirmed: true,
});
test("DNC flags fail closed, preserve restrictions and exclude raw provider data", () => {
  assert.equal(normalizeDncResponse(good, "2025550101").outcome, "PASS");
  for (const field of ["national_dnc", "state_dnc", "dma", "litigator"]) {
    for (const value of ["?", undefined, "", false, "unexpected"]) {
      assert.equal(
        normalizeDncResponse({ ...good, [field]: value }, "2025550101").outcome,
        "UNKNOWN",
      );
    }
    assert.equal(
      normalizeDncResponse(
        { ...good, [field]: "Y", extra: "private-response" },
        "2025550101",
      ).outcome,
      "FAIL",
    );
  }
  assert.equal(
    normalizeDncResponse(
      { ...good, national_dnc: "Y", state_dnc: "?" },
      "2025550101",
    ).outcome,
    "FAIL",
  );
  const result = normalizeDncResponse(
    {
      ...good,
      phone: "2025550101",
      owner: "private-owner",
      token: "private-token",
    },
    "2025550101",
  );
  assert.equal(result.outreachAllowed, false);
  assert.ok(!JSON.stringify(result).includes("private"));
  assert.ok(!JSON.stringify(result).includes("2025550101"));
  assert.throws(
    () => normalizeDncResponse({ ...good, Phone: "2025559999" }, "2025550101"),
    /MISMATCH/,
  );
  for (const code of ["unauthorized", "102", "invalid-phone", "-1", "error"]) {
    assert.throws(
      () =>
        normalizeDncResponse(
          { ...good, RESPONSECODE: code, RESPONSEMSG: "private-error" },
          "2025550101",
        ),
      (e) => e instanceof Error && !e.message.includes("private"),
    );
  }
});
test("DNC connector gates traffic by activation, key, seller scope, expiry and area code", async () => {
  const previous = {
    enabled: process.env.APS_RPV_DNC_ENABLED,
    key: process.env.RPV_API_TOKEN,
  };
  let calls = 0;
  const adapter = new RealPhoneValidationDncAdapter((async () => {
    calls++;
    return Response.json(good);
  }) as typeof fetch);
  try {
    delete process.env.APS_RPV_DNC_ENABLED;
    delete process.env.RPV_API_TOKEN;
    await assert.rejects(
      adapter.lookup(customerId, "+12025550101", auth()),
      /DISABLED/,
    );
    process.env.APS_RPV_DNC_ENABLED = "true";
    await assert.rejects(
      adapter.lookup(customerId, "+12025550101", auth()),
      /KEY_MISSING/,
    );
    process.env.RPV_API_TOKEN = "synthetic-secret";
    for (const authorization of [
      { ...auth(), customerId: "00000000-0000-4000-8000-000000000002" },
      { ...auth(), expiresAt: "2020-01-01T00:00:00Z" },
      { ...auth(), areaCodes: ["212"] },
      { ...auth(), san: "" },
      { ...auth(), providerAccountConfirmed: false },
    ])
      await assert.rejects(
        adapter.lookup(
          customerId,
          "+12025550101",
          authorization as DncAuthorization,
        ),
        /AUTHORIZATION_REQUIRED/,
      );
    await assert.rejects(
      adapter.lookup(customerId, "not-a-phone", auth()),
      /AUTHORIZATION_REQUIRED/,
    );
    assert.equal(calls, 0);
    const transport = new RealPhoneValidationDncAdapter((async (url, init) => {
      calls++;
      assert.equal(
        url,
        "https://api.realvalidation.com/rpvWebService/DNCLookup.php",
      );
      assert.equal(init?.method, "POST");
      assert.equal(init?.redirect, "error");
      const body = new URLSearchParams(String(init?.body));
      assert.equal(body.get("token"), "synthetic-secret");
      assert.equal(body.get("phone"), "2025550101");
      assert.equal(body.get("output"), "json");
      return Response.json(good);
    }) as typeof fetch);
    assert.equal(
      (await transport.lookup(customerId, "+12025550101", auth())).outcome,
      "PASS",
    );
    assert.equal(calls, 1);
    for (const response of [
      new Response("private-error", { status: 403 }),
      new Response("private-error", { status: 500 }),
      new Response("bad json"),
      new Response("x".repeat(32769)),
    ]) {
      let attempts = 0;
      const a = new RealPhoneValidationDncAdapter((async () => {
        attempts++;
        return response;
      }) as typeof fetch);
      await assert.rejects(
        a.lookup(customerId, "+12025550101", auth()),
        (e) =>
          e instanceof Error &&
          e.message.startsWith("RPV_") &&
          !e.message.includes("private"),
      );
      assert.equal(attempts, 1);
    }
    const network = new RealPhoneValidationDncAdapter((async () => {
      throw new Error("private-token");
    }) as typeof fetch);
    await assert.rejects(
      network.lookup(customerId, "+12025550101", auth()),
      /RPV_OUTCOME_UNKNOWN/,
    );
  } finally {
    if (previous.enabled === undefined) delete process.env.APS_RPV_DNC_ENABLED;
    else process.env.APS_RPV_DNC_ENABLED = previous.enabled;
    if (previous.key === undefined) delete process.env.RPV_API_TOKEN;
    else process.env.RPV_API_TOKEN = previous.key;
  }
});
