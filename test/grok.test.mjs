import assert from "node:assert/strict";
import test from "node:test";

import { parseGrokAddArgs } from "../dist/grok.js";
import { fetchGrokUsage, GrokHttpError, parseGrokAuthFile } from "../dist/grok-store.js";

const auth = {
  key: "secret-token",
  auth_mode: "oidc",
  user_id: "user-123",
  email: "grok@example.com",
};

test("parses named and device-code Grok login options", () => {
  assert.deepEqual(parseGrokAddArgs(["work", "--device-code"]), {
    name: "work",
    deviceAuth: true,
  });
  assert.deepEqual(parseGrokAddArgs([]), { deviceAuth: false });
  assert.throws(() => parseGrokAddArgs(["one", "two"]), /extra profile name/);
  assert.throws(() => parseGrokAddArgs(["--wat"]), /Unknown Grok add option/);
});

test("selects the production OAuth credential from Grok's scoped auth file", () => {
  const selected = parseGrokAuthFile({
    "custom::client": { ...auth, key: "custom" },
    "https://auth.x.ai::public-client": auth,
  });
  assert.equal(selected?.key, "secret-token");
  assert.equal(parseGrokAuthFile({ broken: { key: 42 } }), null);
});

test("fetches Grok Build credits and subscription with official CLI headers", async () => {
  const calls = [];
  const fakeFetch = async (url, options) => {
    calls.push([url, options]);
    if (String(url).includes("/billing")) {
      return new Response(JSON.stringify({
        config: {
          creditUsagePercent: 37.5,
          currentPeriod: { type: "USAGE_PERIOD_TYPE_WEEKLY", end: "2026-09-07T00:00:00Z" },
          prepaidBalance: { val: 1250 },
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ subscriptionTier: "SuperGrok" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const usage = await fetchGrokUsage(auth, fakeFetch, "1.2.3");
  assert.equal(usage.config.creditUsagePercent, 37.5);
  assert.equal(usage.subscriptionTier, "SuperGrok");
  assert.equal(calls.length, 2);
  for (const [, options] of calls) {
    assert.equal(options.headers.Authorization, "Bearer secret-token");
    assert.equal(options.headers["X-XAI-Token-Auth"], "xai-grok-cli");
    assert.equal(options.headers["x-userid"], "user-123");
    assert.equal(options.headers["x-grok-client-version"], "1.2.3");
  }
});

test("reports Grok billing HTTP failures with the status", async () => {
  const fakeFetch = async (url) => String(url).includes("/billing")
    ? new Response(JSON.stringify({ error: "not available" }), { status: 403 })
    : new Response("{}", { status: 200 });

  await assert.rejects(
    () => fetchGrokUsage(auth, fakeFetch, "1.2.3"),
    error => error instanceof GrokHttpError && error.status === 403 && /not available/.test(error.message),
  );
});

test("does not claim subscription usage for API-key profiles", async () => {
  await assert.rejects(
    () => fetchGrokUsage({ ...auth, auth_mode: "api_key" }, undefined, "1.2.3"),
    /unavailable for API-key profiles/,
  );
});
