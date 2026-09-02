import type { DailyUsage, OpenAIProject } from "./types.js";
export declare function estimateCostUsd(model: string, inputTokens: number, cachedInputTokens: number, outputTokens: number): number | undefined;
/** Validate an admin key by hitting a cheap endpoint. Returns the org id if found. */
export declare function validateAdminKey(adminKey: string): Promise<{
    ok: true;
    orgId?: string;
} | {
    ok: false;
    error: string;
}>;
/** List all projects in the org. Requires `api.management.read`. */
export declare function listProjects(adminKey: string): Promise<OpenAIProject[]>;
/**
 * Pull per-day cost + token rollups for the trailing N days, plus the top model.
 *
 * Three OpenAI calls fire in parallel: (1) daily costs, (2) daily usage by model,
 * (3) today's hourly usage by model. Today's daily bucket is empty until ~UTC
 * midnight (OpenAI's aggregation lag), so we splice the hourly values in and
 * estimate today's cost from a per-model price table.
 */
export declare function fetchUsageRollup(adminKey: string, days: number, projectId?: string): Promise<{
    daily: DailyUsage[];
    topModel?: {
        model: string;
        tokens: number;
    };
}>;
/** @deprecated Kept as a thin wrapper for back-compat with older callers. */
export declare function fetchDailyUsage(adminKey: string, days: number, projectId?: string): Promise<DailyUsage[]>;
interface TodayHourlyResult {
    date: string;
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    requests: number;
    estimatedCostUsd?: number;
    /** True if all model token weight matched the price table */
    estimateComplete: boolean;
    /** Per-model token totals so callers can fold into a top-model tally */
    tokensByModel: Map<string, number>;
}
/**
 * Fetch today's usage so far, broken by hour and grouped by model. Today's
 * daily bucket lags by ~24h on OpenAI's side, but hourly buckets update
 * within minutes. Estimates cost from a per-model price table.
 */
export declare function fetchTodayHourly(adminKey: string, projectId?: string): Promise<TodayHourlyResult | null>;
export {};
