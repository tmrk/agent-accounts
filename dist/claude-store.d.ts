import type { ClaudeProfile, ClaudeAuthStatus, ClaudeCredentialInfo, ClaudeUsageResponse } from "./types.js";
interface ClaudeUsageCacheEntry {
    fetchedAt?: string;
    usage?: ClaudeUsageResponse;
    retryAfterAt?: string;
}
export declare function readClaudeUsageCache(profileName: string): ClaudeUsageCacheEntry | null;
export declare function writeClaudeUsageCache(profileName: string, entry: ClaudeUsageCacheEntry): void;
export declare function validateProfileName(name: string): string | null;
/** Resolve the instance directory path for a profile.
 *  Uses the stored `dir` field if available, otherwise derives from name. */
export declare function getInstancePath(name: string): string;
/** Create a named profile with its own instance directory */
export declare function createProfile(name: string): string;
/** Create a temporary instance dir for login before we know the email.
 *  Returns { path, dirName } — the dirName is stable and never renamed. */
export declare function createTempInstance(): {
    path: string;
    dirName: string;
};
/** Register a profile pointing to an existing instance directory (no rename). */
export declare function registerProfile(name: string, dirName: string): void;
/** Clean up an instance directory by dir name */
export declare function cleanupInstance(dirName: string): void;
export declare function listProfiles(): ClaudeProfile[];
export declare function findProfile(name: string): ClaudeProfile | null;
export declare function removeProfile(name: string): boolean;
export declare function getActiveProfile(): string | null;
export declare function setActiveProfile(name: string): void;
export declare function detectClaudeCli(): string | null;
/** Get auth status by running `claude auth status` with a given CLAUDE_CONFIG_DIR */
export declare function getAuthStatusForPath(instancePath: string): Promise<ClaudeAuthStatus | null>;
/** Get auth status for a named profile */
export declare function getAuthStatusAsync(name: string): Promise<ClaudeAuthStatus | null>;
/** Config directory Claude Code uses when CLAUDE_CONFIG_DIR is unset. */
export declare function defaultClaudeConfigDir(): string;
/** Home-level account file Claude Code uses when CLAUDE_CONFIG_DIR is unset. */
export declare function defaultClaudeAccountFile(): string;
/**
 * macOS Keychain service for a Claude config directory.
 * An unset CLAUDE_CONFIG_DIR uses the unhashed name. Setting the variable,
 * even to the default path, selects the hashed name instead.
 */
export declare function claudeKeychainService(configDir: string, isolated: boolean): string;
export declare function readOauthEmail(claudeJsonPath: string): string | null;
/** Copy the profile's oauthAccount into Claude's home account file. Other keys are kept. */
export declare function syncOauthAccount(instancePath: string, accountFile: string): boolean;
type SecurityRunner = (args: string[]) => Promise<{
    stdout: string;
}>;
/** Read Claude credential from macOS Keychain or .credentials.json fallback */
export declare function readCredential(instancePath: string): Promise<ClaudeCredentialInfo | null>;
export interface ClaudeLoginWriteOptions {
    platform?: NodeJS.Platform;
    security?: SecurityRunner;
    /** Force the unhashed Keychain service Claude reads when CLAUDE_CONFIG_DIR is unset. */
    defaultLogin?: boolean;
}
/** Write a Claude OAuth payload where Claude Code will read it for this config directory. */
export declare function writeClaudeLogin(targetDir: string, payload: Record<string, unknown>, options?: ClaudeLoginWriteOptions): Promise<void>;
/** Make Claude Code's default login match a stored profile. */
export declare function installClaudeLogin(instancePath: string, targetDir?: string): Promise<void>;
export interface ClaudeCredentialSyncOptions {
    systemConfigDir?: string;
    systemAccountFile?: string;
}
/** Refresh an expiring Claude OAuth credential and persist any rotated tokens. */
export declare function ensureFreshClaudeCredential(instancePath: string, credential: ClaudeCredentialInfo, fetchImpl?: typeof fetch, options?: ClaudeCredentialSyncOptions): Promise<ClaudeCredentialInfo>;
export declare class ClaudeUsageError extends Error {
    status?: number | undefined;
    retryAfterSeconds?: number | undefined;
    constructor(message: string, status?: number | undefined, retryAfterSeconds?: number | undefined);
}
/** Fetch rate limit utilization from /api/oauth/usage */
export declare function fetchClaudeUsage(accessToken: string, fetchImpl?: typeof fetch): Promise<ClaudeUsageResponse>;
export {};
