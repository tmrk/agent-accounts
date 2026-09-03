#!/usr/bin/env node
import { loadClaudeProfiles } from "./claude.js";
import { loadGrokProfiles } from "./grok.js";
import { type SwitchOptions } from "./switch-options.js";
import { type SwitchOutcome } from "./live.js";
import type { AccountUsage } from "./types.js";
export declare function activateCodexAccount(email: string, options?: SwitchOptions): Promise<SwitchOutcome>;
export declare function loadCodexUsages(): Promise<AccountUsage[]>;
export declare function loadAllUsage(): Promise<{
    codex: AccountUsage[];
    claude: Awaited<ReturnType<typeof loadClaudeProfiles>>;
    grok: Awaited<ReturnType<typeof loadGrokProfiles>>;
}>;
