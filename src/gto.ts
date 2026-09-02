import type { AccountUsage } from "./types.js";

export const MIN_NEW_SESSION_HEADROOM = 0.40;

export interface GtoScore {
  isApiKey: boolean;
  hasError: boolean;
  bottleneckHeadroom: number;
  shortHeadroom: number;
  shortResetAfterSeconds: number;
  expiryPressure: number;
  usableForNewSession: boolean;
  reason: string;
}

export function scoreUsageForGto(usage: AccountUsage): GtoScore {
  const isApiKey = usage.email.startsWith("apikey:");
  const hasError = Boolean(usage.error);
  const shortHeadroom = usage.primary ? remaining(usage.primary.usedPercent) : 1;
  const secondaryHeadroom = usage.secondary ? remaining(usage.secondary.usedPercent) : 1;
  const bottleneckHeadroom = isApiKey ? 0.01 : Math.min(shortHeadroom, secondaryHeadroom);
  const shortResetAfterSeconds = usage.primary?.resetAfterSeconds ?? 0;
  const usableForNewSession = !hasError
    && !isApiKey
    && bottleneckHeadroom >= MIN_NEW_SESSION_HEADROOM
    && shortHeadroom >= MIN_NEW_SESSION_HEADROOM;
  const expiryPressure = usableForNewSession && shortResetAfterSeconds > 0
    ? bottleneckHeadroom / shortResetAfterSeconds
    : 0;

  return {
    isApiKey,
    hasError,
    bottleneckHeadroom,
    shortHeadroom,
    shortResetAfterSeconds,
    expiryPressure,
    usableForNewSession,
    reason: reasonForScore({
      isApiKey,
      hasError,
      bottleneckHeadroom,
      shortHeadroom,
      shortResetAfterSeconds,
      expiryPressure,
      usableForNewSession,
      reason: "",
    }),
  };
}

export function rankUsagesForGto(usages: AccountUsage[]): AccountUsage[] {
  const ranked = [...usages].sort(compareUsageForGto);
  return ranked.map((usage, index) => {
    const score = scoreUsageForGto(usage);
    return {
      ...usage,
      gtoRank: index + 1,
      gtoRecommended: index === 0 && !score.hasError,
      gtoReason: score.reason,
    };
  });
}

export function compareUsageForGto(left: AccountUsage, right: AccountUsage): number {
  const a = scoreUsageForGto(left);
  const b = scoreUsageForGto(right);

  if (a.hasError !== b.hasError) return a.hasError ? 1 : -1;
  if (a.isApiKey !== b.isApiKey) return a.isApiKey ? 1 : -1;
  if (a.usableForNewSession !== b.usableForNewSession) return a.usableForNewSession ? -1 : 1;
  if (a.usableForNewSession && b.usableForNewSession && a.expiryPressure !== b.expiryPressure) {
    return b.expiryPressure - a.expiryPressure;
  }
  if (a.bottleneckHeadroom !== b.bottleneckHeadroom) {
    return b.bottleneckHeadroom - a.bottleneckHeadroom;
  }
  if (a.shortResetAfterSeconds !== b.shortResetAfterSeconds) {
    if (a.shortResetAfterSeconds === 0) return 1;
    if (b.shortResetAfterSeconds === 0) return -1;
    return a.shortResetAfterSeconds - b.shortResetAfterSeconds;
  }
  return left.email.localeCompare(right.email);
}

function remaining(usedPercent: number): number {
  return 1 - clamp(usedPercent, 0, 100) / 100;
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function reasonForScore(score: GtoScore): string {
  if (score.hasError) return "usage unavailable";
  if (score.isApiKey) return "API key fallback";
  const left = `${Math.round(score.bottleneckHeadroom * 100)}% bottleneck left`;
  if (!score.usableForNewSession) {
    return `${left}, protected below ${Math.round(MIN_NEW_SESSION_HEADROOM * 100)}%`;
  }
  if (score.shortResetAfterSeconds > 0) {
    return `${left}, 5h resets in ${formatDuration(score.shortResetAfterSeconds)}`;
  }
  return left;
}

function formatDuration(seconds: number): string {
  if (seconds <= 0) return "now";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 && days === 0) parts.push(`${minutes}m`);
  return parts.length > 0 ? parts.join(" ") : "<1m";
}
