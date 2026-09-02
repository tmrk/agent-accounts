import type { AccountUsage, ClaudeProfileInfo, GrokProfileInfo } from "./types.js";
export declare function displayAllUsage(usages: AccountUsage[]): void;
export declare function displayAllUsageNumbered(usages: AccountUsage[]): void;
export declare function displayAccountList(accounts: {
    email: string;
    isActive: boolean;
    addedAt: string;
}[]): void;
export declare function displayClaudeProfiles(profiles: ClaudeProfileInfo[]): void;
export declare function displayClaudeProfilesNumbered(profiles: ClaudeProfileInfo[]): void;
export declare function displayGrokProfiles(profiles: GrokProfileInfo[]): void;
export declare function displayGrokProfilesNumbered(profiles: GrokProfileInfo[]): void;
