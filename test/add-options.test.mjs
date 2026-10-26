import assert from "node:assert/strict";
import test from "node:test";

import { parseAddArgs, parseProviderInvocation, codexLoginArgs } from "../dist/add-options.js";

test("parses device-auth login flag", () => {
  const parsed = parseAddArgs(["--device-auth"]);

  assert.equal(parsed.deviceAuth, true);
});

test("defaults to browser OAuth login", () => {
  const parsed = parseAddArgs([]);

  assert.equal(parsed.deviceAuth, false);
});

test("forwards --device-auth to codex login", () => {
  assert.deepEqual(codexLoginArgs({ deviceAuth: false }), ["login", "-c", "cli_auth_credentials_store=file"]);
  assert.deepEqual(codexLoginArgs({ deviceAuth: true }), ["login", "--device-auth", "-c", "cli_auth_credentials_store=file"]);
});

test("rejects unknown add flags", () => {
  assert.throws(
    () => parseAddArgs(["--bad-flag"]),
    /Unknown add option/,
  );
});

test("rejects extra positional arguments", () => {
  assert.throws(
    () => parseAddArgs(["alice@example.com"]),
    /Unexpected extra argument/,
  );
});

test("routes add and login to the named provider", () => {
  assert.equal(parseProviderInvocation(["add"]), null);
  assert.equal(parseProviderInvocation(["add", "--device-auth"]), null);
  assert.deepEqual(parseProviderInvocation(["add", "claude"]), {
    provider: "claude",
    rest: ["add"],
  });
  assert.deepEqual(parseProviderInvocation(["add", "claude", "work"]), {
    provider: "claude",
    rest: ["add", "work"],
  });
  assert.deepEqual(parseProviderInvocation(["login", "grok", "--device-auth"]), {
    provider: "grok",
    rest: ["login", "--device-auth"],
  });
  assert.deepEqual(parseProviderInvocation(["add", "codex", "--device-auth"]), {
    provider: "codex",
    rest: ["add", "--device-auth"],
  });
});
