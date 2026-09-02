import assert from "node:assert/strict";
import test from "node:test";

import { parseSwitchArgs } from "../dist/switch-options.js";

test("parses GUI restart switch flag", () => {
  const parsed = parseSwitchArgs(["lawrence@example.com", "--restart-codex-gui"]);

  assert.equal(parsed.identifier, "lawrence@example.com");
  assert.equal(parsed.options.restartCodexGui, true);
});

test("gui-switch defaults to restarting Codex.app", () => {
  const parsed = parseSwitchArgs(["lawrence@example.com"], { restartCodexGui: true });

  assert.equal(parsed.identifier, "lawrence@example.com");
  assert.equal(parsed.options.restartCodexGui, true);
});

test("rejects unknown switch flags", () => {
  assert.throws(
    () => parseSwitchArgs(["--bad-flag"]),
    /Unknown switch option/,
  );
});
