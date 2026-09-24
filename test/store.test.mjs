import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { applyFileCredentialStore } from "../dist/store.js";

const STORE_MODULE = pathToFileURL(resolve("dist/store.js")).href;
const CLI_MODULE = pathToFileURL(resolve("dist/index.js")).href;

function jwtWithEmail(email) {
  const payload = Buffer.from(JSON.stringify({
    email,
    "https://api.openai.com/profile": { email },
  })).toString("base64url");
  return `eyJhbGciOiJub25lIn0.${payload}.sig`;
}

function runStore(home, extraEnv, script) {
  return spawnSync(process.execPath, [
    "--input-type=module",
    "--eval",
    `const m = await import(${JSON.stringify(STORE_MODULE)});\n${script}`,
  ], {
    env: { ...process.env, HOME: home, ...extraEnv },
    encoding: "utf-8",
  });
}

test("applyFileCredentialStore pins auto/keyring at top level only", () => {
  const auto = applyFileCredentialStore('model = "gpt"\ncli_auth_credentials_store = "auto"\n');
  assert.equal(auto.changed, true);
  assert.match(auto.text, /cli_auth_credentials_store = "file"/);
  assert.doesNotMatch(auto.text, /"auto"/);

  const already = applyFileCredentialStore('cli_auth_credentials_store = "file"\nmodel = "gpt"\n');
  assert.equal(already.changed, false);
  assert.equal(already.text, 'cli_auth_credentials_store = "file"\nmodel = "gpt"\n');

  const nested = applyFileCredentialStore([
    "[profiles.fast]",
    'cli_auth_credentials_store = "keyring"',
    "",
  ].join("\n"));
  assert.equal(nested.changed, true);
  assert.match(nested.text, /^cli_auth_credentials_store = "file"/);
  assert.match(nested.text, /\[profiles\.fast\]\ncli_auth_credentials_store = "keyring"/);

  const empty = applyFileCredentialStore("");
  assert.equal(empty.changed, true);
  assert.equal(empty.text, 'cli_auth_credentials_store = "file"\n');
});

test("writeActiveAuth updates CODEX_HOME and pins the file credential store", () => {
  const home = mkdtempSync(join(tmpdir(), "aacc-store-"));
  const defaultCodex = join(home, ".codex");
  const codexHome = join(home, "cx-home");
  mkdirSync(defaultCodex, { recursive: true });
  mkdirSync(codexHome, { recursive: true });
  writeFileSync(join(defaultCodex, "auth.json"), JSON.stringify({ OPENAI_API_KEY: "sk-stale" }), { mode: 0o600 });
  writeFileSync(join(codexHome, "config.toml"), 'model = "gpt-5"\ncli_auth_credentials_store = "auto"\n', { mode: 0o600 });
  try {
    const email = "work@example.com";
    const auth = {
      auth_mode: "chatgpt",
      tokens: {
        access_token: "access",
        refresh_token: "refresh",
        id_token: jwtWithEmail(email),
      },
    };
    const child = runStore(home, { CODEX_HOME: codexHome }, `
      m.saveAccount({ email: ${JSON.stringify(email)}, addedAt: "2026-01-01T00:00:00.000Z", auth: ${JSON.stringify(auth)} });
      m.activateAuthOnSystem(${JSON.stringify(auth)});
      const live = m.readActiveAuth();
      const detected = m.detectActiveAccount();
      const config = ${JSON.stringify(join(codexHome, "config.toml"))};
      const defaultAuth = ${JSON.stringify(join(defaultCodex, "auth.json"))};
      console.log(JSON.stringify({
        detected,
        liveEmail: live?.tokens ? "ok" : null,
        config: (await import("node:fs")).readFileSync(config, "utf-8"),
        defaultAuth: JSON.parse((await import("node:fs")).readFileSync(defaultAuth, "utf-8")),
      }));
    `);
    assert.equal(child.status, 0, child.stderr);
    const result = JSON.parse(child.stdout);
    assert.equal(result.detected, email);
    assert.match(result.config, /cli_auth_credentials_store = "file"/);
    assert.doesNotMatch(result.config, /"auto"/);
    assert.equal(result.defaultAuth.OPENAI_API_KEY, "sk-stale");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("pinning file store is a change when Codex was on keyring, even if auth.json already matches", () => {
  const home = mkdtempSync(join(tmpdir(), "aacc-store-"));
  const codexHome = join(home, "cx-home");
  mkdirSync(codexHome, { recursive: true });
  writeFileSync(join(codexHome, "config.toml"), 'cli_auth_credentials_store = "keyring"\n', { mode: 0o600 });
  try {
    const child = runStore(home, { CODEX_HOME: codexHome }, `
      const first = m.ensureCodexFileCredentialStore();
      const second = m.ensureCodexFileCredentialStore();
      console.log(JSON.stringify({ first, second }));
    `);
    assert.equal(child.status, 0, child.stderr);
    assert.deepEqual(JSON.parse(child.stdout), { first: true, second: false });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("persistAccountAuth writes rotated tokens back to the live auth.json", () => {
  const home = mkdtempSync(join(tmpdir(), "aacc-store-"));
  const codexHome = join(home, "cx-home");
  try {
    const email = "live@example.com";
    const original = {
      auth_mode: "chatgpt",
      tokens: {
        access_token: "old-access",
        refresh_token: "old-refresh",
        id_token: jwtWithEmail(email),
      },
    };
    const rotated = {
      ...original,
      tokens: { ...original.tokens, access_token: "new-access", refresh_token: "new-refresh" },
    };
    const child = runStore(home, { CODEX_HOME: codexHome }, `
      m.saveAccount({ email: ${JSON.stringify(email)}, addedAt: "2026-01-01T00:00:00.000Z", auth: ${JSON.stringify(original)} });
      m.writeActiveAuth(${JSON.stringify(original)});
      m.persistAccountAuth(${JSON.stringify(rotated)});
      const live = m.readActiveAuth();
      const stored = m.findAccount(${JSON.stringify(email)});
      console.log(JSON.stringify({
        liveAccess: live.tokens.access_token,
        storedAccess: stored.auth.tokens.access_token,
      }));
    `);
    assert.equal(child.status, 0, child.stderr);
    assert.deepEqual(JSON.parse(child.stdout), {
      liveAccess: "new-access",
      storedAccess: "new-access",
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("Codex status uses the live credential after Codex rotates its tokens", () => {
  const home = mkdtempSync(join(tmpdir(), "aacc-live-auth-"));
  const email = "live@example.com";
  const saved = {
    auth_mode: "chatgpt",
    tokens: { access_token: "old-access", refresh_token: "old-refresh", id_token: jwtWithEmail(email) },
  };
  const live = {
    ...saved,
    tokens: { ...saved.tokens, access_token: "new-access", refresh_token: "new-refresh" },
  };
  try {
    const child = runStore(home, {}, `
      m.saveAccount({ email: ${JSON.stringify(email)}, addedAt: "2026-01-01T00:00:00.000Z", auth: ${JSON.stringify(saved)} });
      m.writeActiveAuth(${JSON.stringify(live)});
      globalThis.fetch = async (_url, options) => {
        if (options.headers.Authorization !== "Bearer new-access") throw new Error("used stale access token");
        return { ok: true, json: async () => ({ plan_type: "plus" }) };
      };
      process.argv = [process.execPath, "aacc", "codex", "status"];
      await import(${JSON.stringify(CLI_MODULE)});
    `);
    assert.equal(child.status, 0, child.stderr);
    assert.doesNotMatch(child.stdout, /used stale access token/);
    const verify = runStore(home, {}, `console.log(JSON.stringify(m.findAccount(${JSON.stringify(email)})?.auth.tokens));`);
    assert.equal(verify.status, 0, verify.stderr);
    assert.equal(JSON.parse(verify.stdout).refresh_token, "new-refresh");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("Codex status does not copy a stale auth.json over a Keychain account", () => {
  const home = mkdtempSync(join(tmpdir(), "aacc-keyring-auth-"));
  const email = "keyring@example.com";
  const stale = {
    auth_mode: "chatgpt",
    tokens: { access_token: "stale-access", refresh_token: "stale-refresh", id_token: jwtWithEmail(email) },
  };
  const saved = {
    ...stale,
    tokens: { ...stale.tokens, access_token: "saved-access", refresh_token: "saved-refresh" },
  };
  try {
    const child = runStore(home, {}, `
      m.saveAccount({ email: ${JSON.stringify(email)}, addedAt: "2026-01-01T00:00:00.000Z", auth: ${JSON.stringify(saved)} });
      m.writeActiveAuth(${JSON.stringify(stale)});
      (await import("node:fs")).writeFileSync(m.getCodexConfigPath(), 'cli_auth_credentials_store = "keyring"\\n');
      globalThis.fetch = async (_url, options) => {
        if (options.headers.Authorization !== "Bearer saved-access") throw new Error("used stale access token");
        return { ok: true, json: async () => ({ plan_type: "plus" }) };
      };
      process.argv = [process.execPath, "aacc", "codex", "status"];
      await import(${JSON.stringify(CLI_MODULE)});
    `);
    assert.equal(child.status, 0, child.stderr);
    const verify = runStore(home, {}, `console.log(JSON.stringify(m.findAccount(${JSON.stringify(email)})?.auth.tokens));`);
    assert.equal(verify.status, 0, verify.stderr);
    assert.equal(JSON.parse(verify.stdout).refresh_token, "saved-refresh");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("switching from Keychain installs the saved account even when stale auth.json has the same email", () => {
  const home = mkdtempSync(join(tmpdir(), "aacc-keyring-switch-"));
  const email = "keyring@example.com";
  const stale = {
    auth_mode: "chatgpt",
    tokens: { access_token: "stale-access", refresh_token: "stale-refresh", id_token: jwtWithEmail(email) },
  };
  const saved = {
    ...stale,
    tokens: { ...stale.tokens, access_token: "saved-access", refresh_token: "saved-refresh" },
  };
  try {
    const child = runStore(home, {}, `
      m.saveAccount({ email: ${JSON.stringify(email)}, addedAt: "2026-01-01T00:00:00.000Z", auth: ${JSON.stringify(saved)} });
      m.writeActiveAuth(${JSON.stringify(stale)});
      (await import("node:fs")).writeFileSync(m.getCodexConfigPath(), 'cli_auth_credentials_store = "keyring"\\n');
      process.argv = [process.execPath, "aacc", "codex", "switch", ${JSON.stringify(email)}];
      await import(${JSON.stringify(CLI_MODULE)});
    `);
    assert.equal(child.status, 0, child.stderr);
    const verify = runStore(home, {}, `console.log(JSON.stringify({ auth: m.readActiveAuth(), fileStore: m.usesCodexFileCredentialStore() }));`);
    assert.equal(verify.status, 0, verify.stderr);
    assert.equal(JSON.parse(verify.stdout).auth.tokens.access_token, "saved-access");
    assert.equal(JSON.parse(verify.stdout).fileStore, true);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("failed refresh does not install an expired account during a switch", () => {
  const home = mkdtempSync(join(tmpdir(), "aacc-switch-auth-"));
  const currentEmail = "current@example.com";
  const targetEmail = "target@example.com";
  const expiredAccess = `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify({ exp: 1 })).toString("base64url")}.sig`;
  const current = {
    auth_mode: "chatgpt",
    tokens: { access_token: "current-access", refresh_token: "current-refresh", id_token: jwtWithEmail(currentEmail) },
  };
  const target = {
    auth_mode: "chatgpt",
    tokens: { access_token: expiredAccess, refresh_token: "expired-refresh", id_token: jwtWithEmail(targetEmail) },
  };
  try {
    const child = runStore(home, {}, `
      m.saveAccount({ email: ${JSON.stringify(currentEmail)}, addedAt: "2026-01-01T00:00:00.000Z", auth: ${JSON.stringify(current)} });
      m.saveAccount({ email: ${JSON.stringify(targetEmail)}, addedAt: "2026-01-01T00:00:00.000Z", auth: ${JSON.stringify(target)} });
      m.writeActiveAuth(${JSON.stringify(current)});
      globalThis.fetch = async () => { throw new Error("refresh unavailable"); };
      process.argv = [process.execPath, "aacc", "codex", "switch", ${JSON.stringify(targetEmail)}];
      await import(${JSON.stringify(CLI_MODULE)});
    `);
    assert.equal(child.status, 1);
    assert.match(child.stderr, /refresh unavailable/);
    const verify = runStore(home, {}, `console.log(JSON.stringify(m.readActiveAuth()?.tokens));`);
    assert.equal(verify.status, 0, verify.stderr);
    assert.equal(JSON.parse(verify.stdout).access_token, "current-access");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
