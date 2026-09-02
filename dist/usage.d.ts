import type { AdditionalRateLimit, CodexAuthFile, UsageResponse, AccountUsage } from "./types.js";
/** Refresh auth and persist if needed, returns fresh auth */
export declare function ensureFreshAuth(auth: CodexAuthFile): Promise<CodexAuthFile>;
export declare function isInvalidatedAuthMessage(message: string): boolean;
export declare function formatAuthError(err: unknown): string;
/** Fetch usage for a single (already-refreshed) auth credential */
export declare function fetchUsage(auth: CodexAuthFile): Promise<UsageResponse>;
/** Refresh if expired, fetch usage, and retry once after a 401 by forcing a refresh. */
export declare function fetchUsageWithRetry(auth: CodexAuthFile): Promise<UsageResponse>;
export declare function loadAccountUsage(email: string, auth: CodexAuthFile, isActive: boolean): Promise<AccountUsage>;
/** Refresh + fetch in one call (convenience for single-account use) */
export declare function refreshAndFetchUsage(auth: CodexAuthFile): Promise<UsageResponse>;
/** Convert raw usage response to display format */
export declare function formatUsage(email: string, isActive: boolean, usage: UsageResponse): AccountUsage;
/** Spark is a ChatGPT Pro research preview. /wham/usage still returns a 0% Spark bucket for Plus. */
export declare function planHasSparkAccess(planType?: string): boolean;
export declare function isSparkAdditionalLimit(limit: AdditionalRateLimit): boolean;
export declare function isReserveAdditionalLimit(limit: AdditionalRateLimit): boolean;
export declare function shouldShowAdditionalLimit(limit: AdditionalRateLimit, planType?: string): boolean;
