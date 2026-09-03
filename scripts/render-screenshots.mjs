#!/usr/bin/env node
/** Render fictional dashboard frames to PNG screenshots for the README. */

import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { composeDashboardFrame, renderCombinedUsage } from "../dist/display.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "docs", "screenshots");
const renderer = join(root, "scripts", "ansi-to-png.py");

const demo = {
  codex: [
    {
      email: "alex@northwind.dev",
      isActive: true,
      planType: "plus",
      gtoRecommended: true,
      gtoReason: "80% bottleneck left, 5h resets in 3h 12m",
      primary: { usedPercent: 20, windowMinutes: 300, resetsIn: "3h 12m" },
      secondary: { usedPercent: 35, windowMinutes: 10080, resetsIn: "5d 4h" },
    },
    {
      email: "jordan@contoso.test",
      isActive: false,
      planType: "team",
      primary: { usedPercent: 72, windowMinutes: 300, resetsIn: "1h 8m" },
      secondary: { usedPercent: 48, windowMinutes: 10080, resetsIn: "4d" },
    },
  ],
  claude: [
    {
      name: "work",
      isActive: true,
      createdAt: "2026-01-12T00:00:00Z",
      auth: {
        loggedIn: true,
        email: "sam@example.com",
        orgName: "Northwind Labs",
        subscriptionType: "pro",
      },
      usage: {
        five_hour: { utilization: 18, resets_at: "2026-09-03T18:40:00Z" },
        seven_day: { utilization: 41, resets_at: "2026-09-07T09:00:00Z" },
      },
    },
    {
      name: "personal",
      isActive: false,
      createdAt: "2026-03-04T00:00:00Z",
      auth: {
        loggedIn: true,
        email: "sam.home@example.org",
        orgName: "Example Org",
        subscriptionType: "max",
      },
      usage: {
        five_hour: { utilization: 62, resets_at: "2026-09-03T16:10:00Z" },
        seven_day: { utilization: 28, resets_at: "2026-09-08T12:00:00Z" },
      },
    },
  ],
  grok: [
    {
      name: "studio",
      isActive: false,
      createdAt: "2026-02-02T00:00:00Z",
      auth: {
        key: "account",
        auth_mode: "oidc",
        user_id: "user-demo",
        email: "riley@example.net",
        organization_name: "Example Net",
      },
      usage: {
        subscriptionTier: "SuperGrok",
        config: {
          creditUsagePercent: 22,
          currentPeriod: { type: "USAGE_PERIOD_TYPE_WEEKLY", end: "2026-09-08T00:00:00Z" },
          prepaidBalance: { val: 1250 },
          onDemandUsed: { val: 80 },
          onDemandCap: { val: 2000 },
        },
      },
    },
    {
      name: "lab",
      isActive: true,
      createdAt: "2026-04-18T00:00:00Z",
      auth: {
        key: "account",
        auth_mode: "oidc",
        user_id: "user-lab",
        email: "riley.lab@contoso.test",
        organization_name: "Contoso Research",
      },
      usage: {
        subscriptionTier: "GrokPro",
        config: {
          creditUsagePercent: 67,
          currentPeriod: { type: "USAGE_PERIOD_TYPE_MONTHLY", end: "2026-09-30T00:00:00Z" },
          prepaidBalance: { val: 0 },
          onDemandUsed: { val: 400 },
          onDemandCap: { val: 1500 },
        },
      },
    },
  ],
};

function renderShot({ width, help }) {
  const body = renderCombinedUsage(demo, { width, numbered: true, tight: true });
  return composeDashboardFrame(body, {
    title: "Agent accounts",
    updatedAt: new Date("2026-09-03T14:32:08Z"),
    intervalSeconds: 30,
    help,
  }, { columns: width, rows: body.length + 3 });
}

function writePng(name, lines) {
  const out = join(outDir, `dashboard-${name}.png`);
  const result = spawnSync("python3", [renderer], {
    input: JSON.stringify({
      lines,
      out,
    }),
    encoding: "utf8",
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout || "png render failed\n");
    throw new Error(`failed to render ${out}`);
  }
  console.log(`wrote ${out}`);
}

mkdirSync(outDir, { recursive: true });
writePng("wide", renderShot({
  width: 88,
  help: "1-6 switch · r refresh · q quit",
}));
writePng("narrow", renderShot({
  width: 52,
  help: "1-6 switch · r refresh · q quit",
}));
