import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  ClaudeUsageError,
  claudeKeychainService,
  ensureFreshClaudeCredential,
  fetchClaudeUsage,
  installClaudeLogin,
  syncOauthAccount,
  writeClaudeLogin,
} from "../dist/claude-store.js";

test("refreshes and atomically persists rotated Claude OAuth credentials", async () => {
  const instancePath = mkdtempSync(join(tmpdir(), "aacc-claude-refresh-"));
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

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value), { mode: 0o600 });
}

test("installs a Claude profile login into the target config directory", async () => {
  const root = mkdtempSync(join(tmpdir(), "aacc-claude-install-"));
  const instance = join(root, "profile");
  const target = join(root, "claude-config");
  try {
    writeJson(join(instance, ".credentials.json"), {
      claudeAiOauth: { accessToken: "access-1", refreshToken: "refresh-1", expiresAt: 1 },
      extra: true,
    });
    await installClaudeLogin(instance, target);
    const installed = JSON.parse(readFileSync(join(target, ".credentials.json"), "utf8"));
    assert.equal(installed.claudeAiOauth.accessToken, "access-1");
    assert.equal(installed.extra, true);
    assert.equal(statSync(join(target, ".credentials.json")).mode & 0o777, 0o600);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("replaces the default account record only when the Claude account changes", () => {
  const root = mkdtempSync(join(tmpdir(), "aacc-claude-oauth-"));
  const instance = join(root, "profile");
  const accountFile = join(root, ".claude.json");
  try {
    writeJson(join(instance, ".claude.json"), {
      oauthAccount: { emailAddress: "new@example.com", accountUuid: "new-id" },
    });
    writeJson(accountFile, { theme: "dark", oauthAccount: { emailAddress: "old@example.com", accountUuid: "old-id", keep: true } });
    assert.equal(syncOauthAccount(instance, accountFile), true);
    const switched = JSON.parse(readFileSync(accountFile, "utf8"));
    assert.equal(switched.theme, "dark");
    assert.equal(switched.oauthAccount.emailAddress, "new@example.com");
    assert.equal(switched.oauthAccount.keep, undefined);

    writeJson(join(instance, ".claude.json"), {
      oauthAccount: { emailAddress: "new@example.com", accountUuid: "new-id", stale: true },
    });
    assert.equal(syncOauthAccount(instance, accountFile), false);
    assert.equal(JSON.parse(readFileSync(accountFile, "utf8")).oauthAccount.stale, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("macOS default login uses the unhashed Keychain service and keeps other secrets", async () => {
  const root = mkdtempSync(join(tmpdir(), "aacc-claude-keychain-"));
  const calls = [];
  const security = async (args) => {
    calls.push(args);
    if (args[0] === "find-generic-password") {
      return { stdout: JSON.stringify({ mcpOAuth: { token: "keep" }, claudeAiOauth: { accessToken: "old" } }) };
    }
    return { stdout: "" };
  };
  try {
    await writeClaudeLogin(root, {
      claudeAiOauth: { accessToken: "new", refreshToken: "refresh-2" },
    }, { platform: "darwin", defaultLogin: true, security });
    const add = calls.find((args) => args[0] === "add-generic-password");
    assert.equal(add[add.indexOf("-s") + 1], "Claude Code-credentials");
    const written = JSON.parse(add[add.indexOf("-w") + 1]);
    assert.equal(written.mcpOAuth.token, "keep");
    assert.equal(written.claudeAiOauth.accessToken, "new");
    const file = JSON.parse(readFileSync(join(root, ".credentials.json"), "utf8"));
    assert.equal(file.mcpOAuth.token, "keep");
    assert.equal(file.claudeAiOauth.refreshToken, "refresh-2");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("isolated Claude config dirs use the hashed Keychain service", () => {
  const dir = "/tmp/claude-isolated-example";
  assert.equal(claudeKeychainService(dir, false), "Claude Code-credentials");
  assert.match(claudeKeychainService(dir, true), /^Claude Code-credentials-[0-9a-f]{8}$/);
});

test("refreshes the same Claude account into the default login and adopts a newer system token", async () => {
  const root = mkdtempSync(join(tmpdir(), "aacc-claude-sync-"));
  const instance = join(root, "profile");
  const system = join(root, "system");
  const accountFile = join(root, "account.json");
  const email = "same@example.com";
  try {
    writeJson(join(instance, ".claude.json"), { oauthAccount: { emailAddress: email } });
    writeJson(accountFile, { oauthAccount: { emailAddress: email } });
    writeJson(join(instance, ".credentials.json"), {
      claudeAiOauth: {
        accessToken: "profile-access",
        refreshToken: "profile-refresh",
        expiresAt: Date.now() - 1000,
      },
    });
    writeJson(join(system, ".credentials.json"), {
      claudeAiOauth: {
        accessToken: "system-access",
        refreshToken: "system-refresh",
        expiresAt: Date.now() - 10_000,
      },
    });

    let calls = 0;
    const fakeFetch = async () => {
      calls += 1;
      return new Response(JSON.stringify({
        access_token: "rotated-access",
        refresh_token: "rotated-refresh",
        expires_in: 28_800,
      }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const refreshed = await ensureFreshClaudeCredential(instance, {
      accessToken: "profile-access",
      refreshToken: "profile-refresh",
      expiresAt: Date.now() - 1000,
    }, fakeFetch, { systemConfigDir: system, systemAccountFile: accountFile });
    assert.equal(calls, 1);
    assert.equal(refreshed.refreshToken, "rotated-refresh");
    const systemCred = JSON.parse(readFileSync(join(system, ".credentials.json"), "utf8"));
    assert.equal(systemCred.claudeAiOauth.refreshToken, "rotated-refresh");

    writeJson(join(system, ".credentials.json"), {
      claudeAiOauth: {
        accessToken: "newer-access",
        refreshToken: "newer-refresh",
        expiresAt: Date.now() + 86_400_000,
      },
    });
    calls = 0;
    const adopted = await ensureFreshClaudeCredential(instance, refreshed, fakeFetch, {
      systemConfigDir: system,
      systemAccountFile: accountFile,
    });
    assert.equal(calls, 0);
    assert.equal(adopted.accessToken, "newer-access");
    assert.equal(adopted.refreshToken, "newer-refresh");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("does not replace a different Claude account on the default login", async () => {
  const root = mkdtempSync(join(tmpdir(), "aacc-claude-other-"));
  const instance = join(root, "profile");
  const system = join(root, "system");
  const accountFile = join(root, "account.json");
  try {
    writeJson(join(instance, ".claude.json"), { oauthAccount: { emailAddress: "profile@example.com" } });
    writeJson(accountFile, { oauthAccount: { emailAddress: "other@example.com" } });
    writeJson(join(instance, ".credentials.json"), {
      claudeAiOauth: { accessToken: "profile-access", refreshToken: "profile-refresh", expiresAt: Date.now() - 1000 },
    });
    writeJson(join(system, ".credentials.json"), {
      claudeAiOauth: { accessToken: "other-access", refreshToken: "other-refresh", expiresAt: Date.now() - 10_000 },
    });
    const fakeFetch = async () => new Response(JSON.stringify({
      access_token: "rotated-access",
      refresh_token: "rotated-refresh",
      expires_in: 28_800,
    }), { status: 200, headers: { "content-type": "application/json" } });
    await ensureFreshClaudeCredential(instance, {
      accessToken: "profile-access",
      refreshToken: "profile-refresh",
      expiresAt: Date.now() - 1000,
    }, fakeFetch, { systemConfigDir: system, systemAccountFile: accountFile });
    const systemCred = JSON.parse(readFileSync(join(system, ".credentials.json"), "utf8"));
    assert.equal(systemCred.claudeAiOauth.refreshToken, "other-refresh");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
