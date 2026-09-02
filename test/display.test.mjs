import assert from "node:assert/strict";
import test from "node:test";

import {
  displayAllUsage,
  displayClaudeProfiles,
  displayGrokProfiles,
} from "../dist/display.js";

const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

function capture(render, columns = 60) {
  const originalLog = console.log;
  const originalColumns = process.env.COLUMNS;
  const lines = [];
  process.env.COLUMNS = String(columns);
  console.log = value => lines.push(String(value ?? ""));
  try {
    render();
  } finally {
    console.log = originalLog;
    if (originalColumns === undefined) delete process.env.COLUMNS;
    else process.env.COLUMNS = originalColumns;
  }
  return lines
    .flatMap(line => line.split("\n"))
    .map(line => line.replace(ANSI_PATTERN, ""));
}

test("renders a responsive Codex dashboard without dropping account data", () => {
  const lines = capture(() => displayAllUsage([{
    email: "person@example.com",
    isActive: true,
    planType: "plus",
    gtoRecommended: true,
    gtoReason: "75% bottleneck left, 5h resets in 4h 55m",
    primary: { usedPercent: 25, windowMinutes: 300, resetsIn: "4h 55m" },
    secondary: { usedPercent: 50, windowMinutes: 10080, resetsIn: "6d" },
  }]), 40);

  assert.ok(lines.every(line => line.length <= 40), lines.join("\n"));
  const normalized = lines.join(" ").replaceAll("│", " ").replace(/\s+/g, " ");
  assert.match(normalized, /CODEX/);
  assert.match(normalized, /PLUS · NEXT · ACTIVE/);
  assert.match(normalized, /75% bottleneck left, 5h resets in 4h 55m/);
  assert.match(normalized, /75\.0% left/);
  assert.match(normalized, /50\.0% left/);
});

test("keeps provider identity, quota, and zero-value billing details visible", () => {
  const claude = capture(() => displayClaudeProfiles([{
    name: "work",
    isActive: true,
    createdAt: "2026-01-01T00:00:00Z",
    auth: {
      loggedIn: true,
      email: "person@example.com",
      orgName: "Example Org",
      subscriptionType: "pro",
    },
    usage: {
      five_hour: { utilization: 92, resets_at: null },
    },
  }]));
  assert.match(claude.join("\n"), /person@example\.com · Example Org/);
  assert.match(claude.join("\n"), /8\.0% left/);

  const grok = capture(() => displayGrokProfiles([{
    name: "personal",
    isActive: true,
    createdAt: "2026-01-01T00:00:00Z",
    auth: { key: "account", auth_mode: "oidc", user_id: "u1", email: "person@example.com" },
    usage: {
      subscriptionTier: "GrokPro",
      config: {
        creditUsagePercent: 10,
        prepaidBalance: { val: 0 },
        onDemandUsed: { val: 0 },
        onDemandCap: { val: 0 },
      },
    },
  }]));
  const output = grok.join("\n");
  assert.match(output, /person@example\.com/);
  assert.match(output, /Prepaid credits\s+\$0/);
  assert.match(output, /On-demand\s+\$0 \/ \$0/);
});
