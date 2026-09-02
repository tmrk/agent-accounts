import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  ClaudeUsageError,
  ensureFreshClaudeCredential,
  fetchClaudeUsage,
} from "../dist/claude-store.js";

test("refreshes and atomically persists rotated Claude OAuth credentials", async () => {
  const instancePath = mkdtempSync(join(tmpdir(), "aa-claude-refresh-"));
  const credentialPath = join(instancePath, ".credentials.json");
  const original = {
    claudeAiOauth: {
      accessToken: "expired-access",
      refreshToken: "old-refresh",
      expiresAt: Date.now() - 1000,
      refreshTokenExpiresAt: Date.now() + 86_400_000,
      scopes: ["user:profile", "user:inference"],
      subscriptionType: "pro",
      preservedField: "keep-me",
    },
    unrelated: true,
  };
  writeFileSync(credentialPath, JSON.stringify(original), { mode: 0o600 });

  const calls = [];
  const fakeFetch = async (url, options) => {
    calls.push([url, options]);
    return new Response(JSON.stringify({
      access_token: "fresh-access",
      refresh_token: "rotated-refresh",
      expires_in: 28_800,
      refresh_token_expires_in: 2_592_000,
      scope: "user:profile user:inference",
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const refreshed = await ensureFreshClaudeCredential(instancePath, original.claudeAiOauth, fakeFetch);
    assert.equal(refreshed.accessToken, "fresh-access");
    assert.equal(refreshed.refreshToken, "rotated-refresh");
    const request = JSON.parse(calls[0][1].body);
    assert.equal(request.grant_type, "refresh_token");
    assert.equal(request.refresh_token, "old-refresh");
    const persisted = JSON.parse(readFileSync(credentialPath, "utf8"));
    assert.equal(persisted.claudeAiOauth.accessToken, "fresh-access");
    assert.equal(persisted.claudeAiOauth.preservedField, "keep-me");
    assert.equal(persisted.unrelated, true);
  } finally {
    rmSync(instancePath, { recursive: true, force: true });
  }
});

test("fetches Claude usage with the OAuth beta header", async () => {
  const calls = [];
  const fakeFetch = async (url, options) => {
    calls.push([url, options]);
    return new Response(JSON.stringify({
      limits: [{ kind: "session", percent: 12, resets_at: "2026-09-03T00:00:00Z" }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const usage = await fetchClaudeUsage("secret-token", fakeFetch);
  assert.equal(usage.limits[0].percent, 12);
  assert.equal(calls[0][1].headers.Authorization, "Bearer secret-token");
  assert.equal(calls[0][1].headers["anthropic-beta"], "oauth-2025-04-20");
});

test("preserves Claude usage retry timing on rate limits", async () => {
  const fakeFetch = async () => new Response("rate limited", {
    status: 429,
    headers: { "retry-after": "3553" },
  });

  await assert.rejects(
    () => fetchClaudeUsage("secret-token", fakeFetch),
    error => error instanceof ClaudeUsageError
      && error.status === 429
      && error.retryAfterSeconds === 3553,
  );
});
