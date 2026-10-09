import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  isCodexAppServerDaemonRunning,
  syncCodexAppServerDaemon,
} from "../dist/codex-daemon.js";

const CLI = resolve("dist/index.js");

function jwtWithEmail(email) {
  const payload = Buffer.from(JSON.stringify({
    email,
    "https://api.openai.com/profile": { email },
  })).toString("base64url");
  return `eyJhbGciOiJub25lIn0.${payload}.sig`;
}

function listen(path) {
  const server = createServer();
  return new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(path, () => resolvePromise(server));
  });
}

function writePid(codexHome, identity) {
  const dir = join(codexHome, "app-server-daemon");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "daemon.pid"), JSON.stringify(identity));
}

test("a missing control socket is not a running daemon", () => {
  const home = mkdtempSync(join(tmpdir(), "aacc-daemon-sock-"));
  try {
    assert.equal(isCodexAppServerDaemonRunning(home), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("a control socket symlink counts as a running daemon", async () => {
  const home = mkdtempSync(join(tmpdir(), "aacc-daemon-link-"));
  const realSock = join(home, "real.sock");
  const codexHome = join(home, "codex");
  const link = join(codexHome, "app-server-control", "app-server-control.sock");
  mkdirSync(join(codexHome, "app-server-control"), { recursive: true });
  const server = await listen(realSock);
  symlinkSync(realSock, link);
  try {
    assert.equal(isCodexAppServerDaemonRunning(codexHome), true);
  } finally {
    server.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test("sync leaves a stopped daemon alone", async () => {
  const calls = [];
  const result = await syncCodexAppServerDaemon("one@example.com", {
    codexHome: "/missing",
    stampPath: "/missing/stamp.json",
    isRunning: () => false,
    runner: async (command, args) => {
      calls.push([command, args]);
      return { code: 0, stdout: "", stderr: "" };
    },
  });
  assert.deepEqual(result, { status: "not-running" });
  assert.deepEqual(calls, []);
});

test("sync restarts a running daemon and remembers that process", async () => {
  const home = mkdtempSync(join(tmpdir(), "aacc-daemon-sync-"));
  const codexHome = join(home, "codex");
  const stampPath = join(home, "stamp.json");
  mkdirSync(codexHome, { recursive: true });
  writePid(codexHome, { pid: 1, processStartTime: "old" });
  const calls = [];
  try {
    const restarted = await syncCodexAppServerDaemon("one@example.com", {
      codexHome,
      stampPath,
      isRunning: () => true,
      runner: async (command, args, options) => {
        calls.push([command, args, options.env.CODEX_HOME]);
        writePid(codexHome, { pid: 2, processStartTime: "new" });
        return { code: 0, stdout: "", stderr: "" };
      },
    });
    assert.deepEqual(restarted, { status: "restarted" });
    assert.deepEqual(calls, [["codex", ["app-server", "daemon", "restart"], codexHome]]);
    assert.equal(JSON.parse(readFileSync(stampPath, "utf-8")).accountKey, "one@example.com");

    const again = await syncCodexAppServerDaemon("one@example.com", {
      codexHome,
      stampPath,
      isRunning: () => true,
      runner: async () => {
        throw new Error("should not restart");
      },
    });
    assert.deepEqual(again, { status: "current" });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("sync does not trust a restart that kept the same daemon process", async () => {
  const home = mkdtempSync(join(tmpdir(), "aacc-daemon-same-"));
  const codexHome = join(home, "codex");
  const stampPath = join(home, "stamp.json");
  writePid(codexHome, { pid: 7, processStartTime: "same" });
  try {
    const result = await syncCodexAppServerDaemon("one@example.com", {
      codexHome,
      stampPath,
      isRunning: () => true,
      runner: async () => ({ code: 0, stdout: "", stderr: "" }),
    });
    assert.equal(result.status, "failed");
    assert.match(result.message, /did not replace/);
    assert.equal(existsSync(stampPath), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("codex switch restarts a daemon that is still signed in after auth.json was replaced", async () => {
  const home = mkdtempSync(join(tmpdir(), "aacc-daemon-stale-"));
  const codexHome = join(home, ".codex");
  const bin = join(home, "bin");
  const log = join(home, "codex.log");
  const email = "fresh@example.com";
  mkdirSync(join(codexHome, "app-server-control"), { recursive: true });
  mkdirSync(join(home, ".agent-accounts", "accounts"), { recursive: true });
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(codexHome, "config.toml"), 'cli_auth_credentials_store = "file"\n');
  const auth = {
    auth_mode: "chatgpt",
    tokens: {
      access_token: "fresh-access",
      refresh_token: "fresh-refresh",
      id_token: jwtWithEmail(email),
    },
  };
  writeFileSync(join(codexHome, "auth.json"), JSON.stringify(auth));
  writePid(codexHome, { pid: 9, processStartTime: "loaded-old-login" });
  writeFileSync(join(home, ".agent-accounts", "accounts", `${email}.json`), JSON.stringify({
    email,
    addedAt: "2026-01-01T00:00:00.000Z",
    auth,
  }));
  writeFileSync(join(bin, "codex"), `#!/bin/sh
printf '%s\\n' "$*" >> ${JSON.stringify(log)}
printf '%s\\n' '{"pid":43,"processStartTime":"reloaded"}' > "$CODEX_HOME/app-server-daemon/daemon.pid"
exit 0
`, { mode: 0o755 });
  const server = await listen(join(codexHome, "app-server-control", "app-server-control.sock"));
  try {
    const result = spawnSync(process.execPath, [CLI, "codex", "switch", email], {
      env: { ...process.env, HOME: home, CODEX_HOME: codexHome, PATH: `${bin}:${process.env.PATH}` },
      encoding: "utf-8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Restarted the Codex app-server so new sessions use this account/);
    assert.match(readFileSync(log, "utf-8"), /app-server daemon restart/);
  } finally {
    server.close();
    rmSync(home, { recursive: true, force: true });
  }
});

test("codex switch restarts a live app-server and does not restart it again", async () => {
  const home = mkdtempSync(join(tmpdir(), "aacc-daemon-cli-"));
  const codexHome = join(home, ".codex");
  const bin = join(home, "bin");
  const log = join(home, "codex.log");
  const email = "fresh@example.com";
  const other = "spent@example.com";
  mkdirSync(join(codexHome, "app-server-control"), { recursive: true });
  mkdirSync(join(home, ".agent-accounts", "accounts"), { recursive: true });
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(codexHome, "config.toml"), 'cli_auth_credentials_store = "file"\n');
  writeFileSync(join(codexHome, "auth.json"), JSON.stringify({
    auth_mode: "chatgpt",
    tokens: {
      access_token: "spent-access",
      refresh_token: "spent-refresh",
      id_token: jwtWithEmail(other),
    },
  }));
  writePid(codexHome, { pid: 9, processStartTime: "before-switch" });
  writeFileSync(join(home, ".agent-accounts", "accounts", `${email}.json`), JSON.stringify({
    email,
    addedAt: "2026-01-01T00:00:00.000Z",
    auth: {
      auth_mode: "chatgpt",
      tokens: {
        access_token: "fresh-access",
        refresh_token: "fresh-refresh",
        id_token: jwtWithEmail(email),
      },
    },
  }));
  writeFileSync(join(bin, "codex"), `#!/bin/sh
printf '%s\\n' "$*" >> ${JSON.stringify(log)}
mkdir -p "$CODEX_HOME/app-server-daemon"
printf '%s\\n' '{"pid":42,"processStartTime":"after-switch"}' > "$CODEX_HOME/app-server-daemon/daemon.pid"
exit 0
`, { mode: 0o755 });
  const sock = join(codexHome, "app-server-control", "app-server-control.sock");
  const server = await listen(sock);
  const env = {
    ...process.env,
    HOME: home,
    CODEX_HOME: codexHome,
    PATH: `${bin}:${process.env.PATH}`,
  };
  try {
    const first = spawnSync(process.execPath, [CLI, "codex", "switch", email], { env, encoding: "utf-8" });
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /Switched to fresh@example.com/);
    assert.match(first.stdout, /Restarted the Codex app-server so new sessions use this account/);
    assert.match(readFileSync(log, "utf-8"), /app-server daemon restart/);
    const auth = JSON.parse(readFileSync(join(codexHome, "auth.json"), "utf-8"));
    assert.equal(auth.tokens.access_token, "fresh-access");

    const second = spawnSync(process.execPath, [CLI, "codex", "switch", email], { env, encoding: "utf-8" });
    assert.equal(second.status, 0, second.stderr);
    assert.match(second.stdout, /Already using fresh@example.com/);
    assert.equal(readFileSync(log, "utf-8").trim().split("\n").length, 1);
  } finally {
    server.close();
    rmSync(home, { recursive: true, force: true });
  }
});
