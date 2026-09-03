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

function barSpan(line) {
  const start = [...line].findIndex(ch => ch === "█" || ch === "░");
  if (start < 0) return null;
  const chars = [...line];
  let end = start;
  while (end < chars.length && (chars[end] === "█" || chars[end] === "░")) end += 1;
  return { start, end, width: end - start };
}

function assertQuotaGrid(lines) {
  const quota = lines.filter(line => line.includes("% left"));
  assert.ok(quota.length >= 2, lines.join("\n"));
  const spans = quota.map(barSpan);
  assert.ok(spans.every(Boolean), quota.join("\n"));
  assert.equal(new Set(spans.map(span => span.start)).size, 1, quota.join("\n"));
  assert.equal(new Set(spans.map(span => span.end)).size, 1, quota.join("\n"));
  assert.equal(new Set(spans.map(span => span.width)).size, 1, quota.join("\n"));
  assert.equal(new Set(quota.map(line => line.indexOf("% left"))).size, 1, quota.join("\n"));
  const resets = quota.filter(line => line.includes("↻"));
  if (resets.length) {
    assert.equal(resets.length, quota.length, quota.join("\n"));
    assert.equal(new Set(resets.map(line => line.indexOf("↻"))).size, 1, quota.join("\n"));
  }
}

const combinedSample = () => ({
  codex: [
    sampleCodex(),
    {
      email: "other@example.com",
      isActive: false,
      planType: "team",
      primary: { usedPercent: 90, windowMinutes: 300, resetsIn: "12m" },
      secondary: { usedPercent: 10, windowMinutes: 10080, resetsIn: "6d 11h" },
    },
  ],
  claude: [{
    name: "work",
    isActive: true,
    createdAt: "2026-01-01T00:00:00Z",
    auth: { loggedIn: true, email: "a@example.com", subscriptionType: "pro" },
    usage: {
      five_hour: { utilization: 10, resets_at: "2099-01-01T00:00:00Z" },
      seven_day: { utilization: 40, resets_at: "2099-01-04T00:00:00Z" },
    },
  }],
  grok: [{
    name: "studio",
    isActive: false,
    createdAt: "2026-01-01T00:00:00Z",
    auth: { key: "account", auth_mode: "oidc", user_id: "u1", email: "b@example.net" },
    usage: {
      config: {
        creditUsagePercent: 40,
        currentPeriod: { type: "week", end: "2099-02-01T00:00:00Z" },
        prepaidBalance: { val: 1250 },
        onDemandUsed: { val: 80 },
        onDemandCap: { val: 2000 },
      },
    },
  }],
});

test("aligns quota bars and percent columns across rows", () => {
  const lines = visible(renderCodexUsage(combinedSample().codex, { width: 88, tight: true }));
  assertQuotaGrid(lines);
});

test("keeps combined-dashboard quota columns aligned across providers", () => {
  const lines = visible(renderCombinedUsage(combinedSample(), { width: 88, numbered: true, tight: true }));
  assertQuotaGrid(lines);
  assert.match(lines.join("\n"), /Weekly limit/);
  assert.match(lines.join("\n"), /Prepaid credits/);
});

test("keeps quota bar edges aligned in a narrow combined dashboard", () => {
  const lines = visible(renderCombinedUsage(combinedSample(), { width: 52, numbered: true, tight: true }));
  assertQuotaGrid(lines);
});

test("clips a live frame to the terminal height without using a full clear", () => {
  const body = renderCodexUsage([sampleCodex()], { width: 40, numbered: true, tight: true });
  const frame = visible(composeDashboardFrame(body, {
    title: "Agent accounts",
    updatedAt: new Date("2026-09-03T12:00:00Z"),
    intervalSeconds: 30,
    help: "1 switch · r refresh · q quit",
  }, { columns: 40, rows: 8 }));

  assert.ok(frame.length <= 8);
  assert.ok(frame.every(line => line.length <= 40));
  assert.match(frame[0], /Agent accounts/);
  assert.match(frame.at(-1), /1 switch/);
  assert.match(frame.join("\n"), /truncated/i);
});
