import type { AccountUsage } from "./types.js";
export declare const MIN_NEW_SESSION_HEADROOM = 0.4;
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
export declare function scoreUsageForGto(usage: AccountUsage): GtoScore;
export declare function rankUsagesForGto(usages: AccountUsage[]): AccountUsage[];
export declare function compareUsageForGto(left: AccountUsage, right: AccountUsage): number;
