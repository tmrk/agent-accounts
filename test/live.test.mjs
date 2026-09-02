import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_LIVE_INTERVAL_SECONDS,
  parseLiveArgs,
} from "../dist/live.js";

test("enables live mode without changing the command", () => {
  assert.deepEqual(parseLiveArgs(["status", "--live"]), {
    args: ["status"],
    options: { enabled: true, intervalSeconds: DEFAULT_LIVE_INTERVAL_SECONDS },
  });
});

test("accepts both live interval forms anywhere in the command", () => {
  assert.deepEqual(parseLiveArgs(["--live=15", "codex", "status"]), {
    args: ["codex", "status"],
    options: { enabled: true, intervalSeconds: 15 },
  });
  assert.deepEqual(parseLiveArgs(["claude", "--interval", "10", "--live"]), {
    args: ["claude"],
    options: { enabled: true, intervalSeconds: 10 },
  });
});

test("rejects invalid or standalone intervals", () => {
  assert.throws(() => parseLiveArgs(["--live", "--interval", "2"]), /5 to 3600/);
  assert.throws(() => parseLiveArgs(["--interval=30", "status"]), /together with --live/);
  assert.throws(() => parseLiveArgs(["--live=soon"]), /whole number/);
});
