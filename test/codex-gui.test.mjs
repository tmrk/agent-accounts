import assert from "node:assert/strict";
import test from "node:test";

import { restartCodexGui } from "../dist/codex-gui.js";

test("restartCodexGui kills and reopens a running Codex.app", async () => {
  const calls = [];
  let pgrepCalls = 0;
  const runner = async (command, args) => {
    calls.push([command, args]);
    if (command === "pgrep") {
      pgrepCalls++;
      return pgrepCalls === 1
        ? { code: 0, stdout: "123\n", stderr: "" }
        : { code: 1, stdout: "", stderr: "" };
    }
    return { code: 0, stdout: "", stderr: "" };
  };

  const result = await restartCodexGui(runner, "darwin");

  assert.deepEqual(result, { status: "restarted" });
  assert.deepEqual(calls, [
    ["pgrep", ["-x", "Codex"]],
    ["pkill", ["-x", "Codex"]],
    ["pgrep", ["-x", "Codex"]],
    ["pgrep", ["-x", "Codex"]],
    ["open", ["-b", "com.openai.codex"]],
  ]);
});

test("restartCodexGui is a no-op when Codex.app is not running", async () => {
  const calls = [];
  const runner = async (command, args) => {
    calls.push([command, args]);
    return { code: 1, stdout: "", stderr: "" };
  };

  const result = await restartCodexGui(runner, "darwin");

  assert.deepEqual(result, { status: "not-running" });
  assert.deepEqual(calls, [["pgrep", ["-x", "Codex"]]]);
});

test("restartCodexGui reports unsupported platforms", async () => {
  const result = await restartCodexGui(async () => {
    throw new Error("should not run");
  }, "linux");

  assert.equal(result.status, "unsupported");
});
