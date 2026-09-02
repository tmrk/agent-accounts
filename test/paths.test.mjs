import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("copies the legacy store once without removing it", () => {
  const home = mkdtempSync(join(tmpdir(), "agent-accounts-migration-"));
  try {
    const legacy = join(home, ".codex-accounts");
    mkdirSync(join(legacy, "accounts"), { recursive: true });
    writeFileSync(join(legacy, "accounts", "example.json"), "legacy-data", { mode: 0o600 });

    const moduleUrl = pathToFileURL(resolve("dist/paths.js")).href;
    const child = spawnSync(process.execPath, [
      "--input-type=module",
      "--eval",
      `const m = await import(${JSON.stringify(moduleUrl)}); m.ensureStoreDir();`,
    ], {
      env: { ...process.env, HOME: home },
      encoding: "utf-8",
    });

    assert.equal(child.status, 0, child.stderr);
    const migrated = join(home, ".agent-accounts", "accounts", "example.json");
    assert.equal(readFileSync(migrated, "utf-8"), "legacy-data");
    assert.equal(existsSync(join(legacy, "accounts", "example.json")), true);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
