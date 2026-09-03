import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_LIVE_INTERVAL_SECONDS,
  alreadyActiveOutcome,
  commitTypedNumber,
  interpretKey,
  parseLiveArgs,
  shouldRunLiveDashboard,
} from "../dist/live.js";
import { leaveDashboardScreen, paintFrame } from "../dist/term.js";

test("enables live mode without changing the command", () => {
  assert.deepEqual(parseLiveArgs(["status", "--live"]), {
    args: ["status"],
    options: { enabled: true, once: false, intervalSeconds: DEFAULT_LIVE_INTERVAL_SECONDS },
  });
});

test("accepts both live interval forms anywhere in the command", () => {
  assert.deepEqual(parseLiveArgs(["--live=15", "codex", "status"]), {
    args: ["codex", "status"],
    options: { enabled: true, once: false, intervalSeconds: 15 },
  });
  assert.deepEqual(parseLiveArgs(["claude", "--interval", "10", "--live"]), {
    args: ["claude"],
    options: { enabled: true, once: false, intervalSeconds: 10 },
  });
  assert.deepEqual(parseLiveArgs(["--interval=10"]), {
    args: [],
    options: { enabled: false, once: false, intervalSeconds: 10 },
  });
});

test("rejects invalid or conflicting live flags", () => {
  assert.throws(() => parseLiveArgs(["--live", "--interval", "2"]), /5 to 3600/);
  assert.throws(() => parseLiveArgs(["--interval=30", "add"]), /live dashboard/);
  assert.throws(() => parseLiveArgs(["--live=soon"]), /whole number/);
  assert.throws(() => parseLiveArgs(["--live", "--once"]), /either --live or --once/);
});

test("opens the dashboard for a TTY aa, and a snapshot with --once", () => {
  const tty = { stdinIsTTY: true, stdoutIsTTY: true };
  const parsed = parseLiveArgs([]);
  assert.equal(shouldRunLiveDashboard(parsed.args, parsed.options, tty), true);
  assert.equal(shouldRunLiveDashboard(["status"], parsed.options, tty), true);
  assert.equal(shouldRunLiveDashboard(["status"], parsed.options, { stdinIsTTY: false, stdoutIsTTY: false }), false);

  const once = parseLiveArgs(["--once"]);
  assert.equal(shouldRunLiveDashboard(once.args, once.options, tty), false);
});

test("maps dashboard keys to quit, refresh, and digit entry", () => {
  assert.equal(interpretKey({ name: "q" }).type, "quit");
  assert.equal(interpretKey({ name: "escape" }).type, "quit");
  assert.equal(interpretKey({ name: "c", ctrl: true }).type, "quit");
  assert.equal(interpretKey({ name: "r" }).type, "refresh");
  assert.deepEqual(interpretKey({ name: "1" }, "1"), { type: "digit", value: "1" });
  assert.equal(interpretKey({ name: "return" }).type, "submit");
});

test("commits a number as soon as it cannot be a prefix of a larger index", () => {
  assert.deepEqual(commitTypedNumber("1", 3), { type: "select", index: 1 });
  assert.deepEqual(commitTypedNumber("1", 12), { type: "wait" });
  assert.deepEqual(commitTypedNumber("12", 12), { type: "select", index: 12 });
  assert.deepEqual(commitTypedNumber("3", 2), { type: "invalid" });
});

test("treats an already-active account as a no-op switch", () => {
  assert.deepEqual(alreadyActiveOutcome("work"), {
    status: "already-active",
    label: "work",
  });
});

test("paints by homing the cursor instead of clearing the screen", () => {
  const writes = [];
  const sequence = paintFrame(["hello", "world"], { columns: 10, rows: 4 }, {
    write(chunk) { writes.push(chunk); },
  });
  assert.equal(writes.length, 1);
  assert.match(sequence, /\x1b\[H/);
  assert.match(sequence, /\x1b\[J/);
  assert.doesNotMatch(sequence, /\x1b\[2J/);
});

test("restores the terminal and ends on a new line when leaving the dashboard", () => {
  const writes = [];
  leaveDashboardScreen({ write(chunk) { writes.push(chunk); } });
  const sequence = writes.join("");
  assert.match(sequence, /\x1b\[\?1049l/);
  assert.match(sequence, /\x1b\[\?25h/);
  assert.match(sequence, /\r\n$/);
});
