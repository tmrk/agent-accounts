import assert from "node:assert/strict";
import test from "node:test";

import {
  composeDashboardFrame,
  renderClaudeProfiles,
  renderCodexUsage,
  renderCombinedUsage,
  renderGrokProfiles,
} from "../dist/display.js";

const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

function visible(lines) {
  return lines
    .flatMap(line => String(line ?? "").split("\n"))
    .map(line => line.replace(ANSI_PATTERN, ""));
}

function sampleCodex() {
  return {
    email: "person@example.com",
    isActive: true,
    planType: "plus",
    gtoRecommended: true,
    gtoReason: "75% bottleneck left, 5h resets in 4h 55m",
    primary: { usedPercent: 25, windowMinutes: 300, resetsIn: "4h 55m" },
    secondary: { usedPercent: 50, windowMinutes: 10080, resetsIn: "6d" },
  };
}

test("renders a responsive Codex dashboard without dropping account data", () => {
  const lines = visible(renderCodexUsage([sampleCodex()], { width: 40 }));

  assert.ok(lines.every(line => line.length <= 40), lines.join("\n"));
  const normalized = lines.join(" ").replaceAll("│", " ").replace(/\s+/g, " ");
  assert.match(normalized, /CODEX/);
  assert.match(normalized, /PLUS · NEXT · ACTIVE/);
  assert.match(normalized, /75% bottleneck left, 5h resets in 4h 55m/);
  assert.match(normalized, /75\.0% left/);
  assert.match(normalized, /50\.0% left/);
});

test("reflows quota bars when the terminal gets wider", () => {
  const narrow = visible(renderCodexUsage([sampleCodex()], { width: 40, tight: true }));
  const wide = visible(renderCodexUsage([sampleCodex()], { width: 100, tight: true }));
  assert.ok(narrow.every(line => line.length <= 40));
  assert.ok(wide.some(line => line.length > 40));
  assert.ok(wide.every(line => line.length <= 100));
});

test("numbers accounts across providers from a shared index", () => {
  const lines = visible(renderCombinedUsage({
    codex: [sampleCodex()],
    claude: [{
      name: "work",
      isActive: true,
      createdAt: "2026-01-01T00:00:00Z",
      auth: { loggedIn: true, email: "person@example.com", subscriptionType: "pro" },
    }],
    grok: [{
      name: "personal",
      isActive: false,
      createdAt: "2026-01-01T00:00:00Z",
      auth: { key: "account", auth_mode: "oidc", user_id: "u1", email: "person@example.com" },
    }],
  }, { width: 60, numbered: true, tight: true }));

  const text = lines.join("\n");
  assert.match(text, /1\. person@example\.com/);
  assert.match(text, /2\. work/);
  assert.match(text, /3\. personal/);
});

test("keeps provider identity, quota, and zero-value billing details visible", () => {
  const claude = visible(renderClaudeProfiles([{
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
  }], { width: 60 }));
  assert.match(claude.join("\n"), /person@example\.com · Example Org/);
  assert.match(claude.join("\n"), /8\.0% left/);

  const grok = visible(renderGrokProfiles([{
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
  }], { width: 60 }));
  const output = grok.join("\n");
  assert.match(output, /person@example\.com/);
  assert.match(output, /Prepaid credits\s+\$0/);
  assert.match(output, /On-demand\s+\$0 \/ \$0/);
});

test("clips a live frame to the terminal height without using a full clear", () => {
  const body = renderCodexUsage([sampleCodex()], { width: 40, numbered: true, tight: true });
  const frame = visible(composeDashboardFrame(body, {
    title: "Agent accounts",
    updatedAt: new Date("2026-09-03T12:00:00Z"),
    intervalSeconds: 30,
    help: "1 switch · r refresh · q quit",
  }, { columns: 40, rows: 8 }));

  assert.equal(frame.length, 8);
  assert.ok(frame.every(line => line.length <= 40));
  assert.match(frame[0], /Agent accounts/);
  assert.match(frame.at(-1), /1 switch/);
  assert.match(frame.join("\n"), /truncated/i);
});
