import type { AccountUsage, ClaudeProfileInfo, GrokProfileInfo } from "./types.js";
import { type ViewSize } from "./term.js";
export interface RenderOptions {
    width?: number;
    numbered?: boolean;
    startIndex?: number;
    /** Omit the blank line before a section (used when composing a live frame). */
    tight?: boolean;
}
export declare function renderCodexUsage(usages: AccountUsage[], options?: RenderOptions): string[];
export declare function displayAllUsage(usages: AccountUsage[]): void;
export declare function displayAllUsageNumbered(usages: AccountUsage[]): void;
export declare function renderAccountList(accounts: {
    email: string;
    isActive: boolean;
    addedAt: string;
}[], options?: RenderOptions): string[];
export declare function displayAccountList(accounts: {
    email: string;
    isActive: boolean;
    addedAt: string;
}[]): void;
export declare function renderClaudeProfiles(profiles: ClaudeProfileInfo[], options?: RenderOptions): string[];
export declare function displayClaudeProfiles(profiles: ClaudeProfileInfo[]): void;
export declare function displayClaudeProfilesNumbered(profiles: ClaudeProfileInfo[]): void;
export declare function renderGrokProfiles(profiles: GrokProfileInfo[], options?: RenderOptions): string[];
export declare function displayGrokProfiles(profiles: GrokProfileInfo[]): void;
export declare function displayGrokProfilesNumbered(profiles: GrokProfileInfo[]): void;
export interface CombinedUsage {
    codex: AccountUsage[];
    claude: ClaudeProfileInfo[];
    grok: GrokProfileInfo[];
}
export declare function renderCombinedUsage(data: CombinedUsage, options?: RenderOptions): string[];
export interface LiveChrome {
    title?: string;
    updatedAt?: Date;
    intervalSeconds?: number;
    refreshing?: boolean;
    message?: string;
    help?: string;
}
export declare function composeDashboardFrame(body: string[], chrome: LiveChrome, size: ViewSize): string[];
