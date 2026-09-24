import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const { version } = JSON.parse(readFileSync(resolve("package.json"), "utf-8"));

test("version commands report the package version without loading account data", () => {
  for (const command of ["version", "--version", "-V"]) {
    const result = spawnSync(process.execPath, [resolve("dist/index.js"), command], { encoding: "utf-8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, `agent-accounts ${version}\n`);
  }
});
