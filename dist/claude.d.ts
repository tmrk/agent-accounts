import { type SwitchOutcome } from "./live.js";
import type { ClaudeProfileInfo } from "./types.js";
/** Fetch auth status, credentials, and usage for all profiles in parallel */
export declare function loadClaudeProfiles(): Promise<ClaudeProfileInfo[]>;
export declare function claudeStatus(): Promise<void>;
export declare function activateClaudeProfile(name: string): SwitchOutcome;
/** Main router for 'aacc claude ...' subcommands */
export declare function claudeMain(args: string[]): Promise<void>;
