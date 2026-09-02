import assert from "node:assert/strict";
import test from "node:test";

import { runCodexLogin } from "../dist/codex-login.js";

test("runCodexLogin forwards device-auth to the codex binary", async () => {
  const calls = [];
  const runner = async (command, args) => {
    calls.push([command, args]);
    return { code: 0 };
  };

  await runCodexLogin({ deviceAuth: true }, runner);

  assert.deepEqual(calls, [["codex", ["login", "--device-auth", "-c", "cli_auth_credentials_store=file"]]]);
});

test("runCodexLogin uses browser OAuth by default", async () => {
  const calls = [];
  const runner = async (command, args) => {
    calls.push([command, args]);
    return { code: 0 };
  };

  await runCodexLogin({ deviceAuth: false }, runner);

  assert.deepEqual(calls, [["codex", ["login", "-c", "cli_auth_credentials_store=file"]]]);
});

test("runCodexLogin forwards an isolated CODEX_HOME", async () => {
  let seenEnv;
  await runCodexLogin(
    { deviceAuth: true },
    async (_command, _args, spawnOptions) => {
      seenEnv = spawnOptions?.env;
      return { code: 0 };
    },
    { env: { CODEX_HOME: "/tmp/cx-login" } },
  );

  assert.equal(seenEnv.CODEX_HOME, "/tmp/cx-login");
});

test("runCodexLogin treats a non-zero exit as failure", async () => {
  await assert.rejects(
    () => runCodexLogin({ deviceAuth: true }, async () => ({ code: 1 })),
    /codex login --device-auth -c cli_auth_credentials_store=file exited with code 1/,
  );
});

test("runCodexLogin reports spawn failures", async () => {
  await assert.rejects(
    () => runCodexLogin({ deviceAuth: false }, async () => {
      throw new Error("ENOENT");
    }),
    /Failed to run 'codex login -c cli_auth_credentials_store=file': ENOENT/,
  );
});
