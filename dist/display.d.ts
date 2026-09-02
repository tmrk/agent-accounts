import type { AccountUsage, ClaudeProfileInfo, GrokProfileInfo } from "./types.js";
/** Display usage for all accounts */
export declare function displayAllUsage(usages: AccountUsage[]): void;
/** Display usage for all accounts with numbered indices for interactive selection */
export declare function displayAllUsageNumbered(usages: AccountUsage[]): void;
/** Display a simple account list */
export declare function displayAccountList(accounts: {
    email: string;
    isActive: boolean;
    addedAt: string;
}[]): void;
/** Display Claude profiles */
export declare function displayClaudeProfiles(profiles: ClaudeProfileInfo[]): void;
/** Display Claude profiles with numbered indices for interactive selection */
export declare function displayClaudeProfilesNumbered(profiles: ClaudeProfileInfo[]): void;
export declare function displayGrokProfiles(profiles: GrokProfileInfo[]): void;
export declare function displayGrokProfilesNumbered(profiles: GrokProfileInfo[]): void;
