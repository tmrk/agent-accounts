import assert from "node:assert/strict";
import test from "node:test";

import { rankUsagesForGto, scoreUsageForGto } from "../dist/gto.js";

function oauth(email, used5h, used7d, reset5hSeconds) {
  return {
    email,
    isActive: false,
    planType: "pro",
    primary: {
      usedPercent: used5h,
      windowMinutes: 300,
      resetAfterSeconds: reset5hSeconds,
    },
    secondary: {
      usedPercent: used7d,
      windowMinutes: 7 * 24 * 60,
      resetAfterSeconds: 7 * 24 * 60 * 60,
    },
  };
}

test("ranks the pasted account snapshot by expiring healthy quota", () => {
  const ranked = rankUsagesForGto([
    oauth("aifirehose@gmail.com", 73, 16, 157 * 60),
    {
      email: "apikey:lawrence-codex-1",
      isActive: false,
      apiKeyHint: "cached spend",
    },
    oauth("austin@manaflow.ai", 0, 0, 300 * 60),
    oauth("founders@manaflow.ai", 0, 0, 164 * 60),
    oauth("lawrence@manaflow.ai", 7, 1, 175 * 60),
    oauth("lawrence@manaflow.com", 0, 0, 300 * 60),
  ]);

  assert.deepEqual(ranked.map(account => account.email), [
    "founders@manaflow.ai",
    "lawrence@manaflow.ai",
    "austin@manaflow.ai",
    "lawrence@manaflow.com",
    "aifirehose@gmail.com",
    "apikey:lawrence-codex-1",
  ]);
  assert.equal(ranked[0].gtoRecommended, true);
});

test("protects low 5h headroom even when it resets slightly sooner", () => {
  const ranked = rankUsagesForGto([
    oauth("soon-low@example.com", 73, 16, 157 * 60),
    oauth("soon-full@example.com", 0, 0, 164 * 60),
  ]);

  assert.equal(ranked[0].email, "soon-full@example.com");
  assert.match(ranked[1].gtoReason, /protected below 40%/);
});

test("computes expiry pressure from bottleneck headroom and short reset", () => {
  const score = scoreUsageForGto(oauth("healthy@example.com", 10, 20, 3 * 60 * 60));

  assert.equal(score.usableForNewSession, true);
  assert.equal(score.bottleneckHeadroom, 0.8);
  assert.equal(score.shortHeadroom, 0.9);
  assert.equal(score.expiryPressure, 0.8 / (3 * 60 * 60));
});
