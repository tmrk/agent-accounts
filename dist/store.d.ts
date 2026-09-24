import type { StoredAccount, CodexAuthFile, AdminKeyEntry, ApiKeyUsageSnapshot } from "./types.js";
/** Codex home: `$CODEX_HOME` when set, otherwise `~/.codex`. */
export declare function getCodexHome(): string;
export declare function getCodexAuthPath(): string;
export declare function getCodexConfigPath(): string;
/** Whether auth.json is Codex's configured credential source. The default is file. */
export declare function usesCodexFileCredentialStore(): boolean;
/** Read an auth.json from a Codex home directory. */
export declare function readAuthFromHome(codexHome: string): CodexAuthFile | null;
/** Read the current active auth from `$CODEX_HOME/auth.json`. */
export declare function readActiveAuth(): CodexAuthFile | null;
/**
 * Pin Codex to file-backed credentials so account switches via auth.json take
 * effect. `auto`/`keyring` keep the OS keyring as source of truth, which makes
 * the dashboard look switched while `codex` still uses the previous login.
 *
 * Only rewrites the top-level `cli_auth_credentials_store` key; profile tables
 * are left alone. Returns true when config.toml was created or changed.
 */
export declare function applyFileCredentialStore(configToml: string): {
    text: string;
    changed: boolean;
};
export declare function ensureCodexFileCredentialStore(): boolean;
/** Write auth to `$CODEX_HOME/auth.json` (with backup). */
export declare function writeActiveAuth(auth: CodexAuthFile): void;
/** Pin the file credential store and write the auth Codex will load on the next process. */
export declare function activateAuthOnSystem(auth: CodexAuthFile): void;
/** Save an account to the store */
export declare function saveAccount(account: StoredAccount): void;
/** List all stored accounts */
export declare function listAccounts(): StoredAccount[];
/** Find a stored account by email */
export declare function findAccount(email: string): StoredAccount | null;
/** Remove an account from the store */
export declare function removeAccount(email: string): boolean;
/** Detect which stored account is currently active */
export declare function detectActiveAccount(): string | null;
export declare function listAdminKeys(): AdminKeyEntry[];
export declare function findAdminKey(label: string): AdminKeyEntry | null;
export declare function saveAdminKey(entry: AdminKeyEntry): void;
export declare function removeAdminKey(label: string): boolean;
/** Pick the admin key to use for an API-key account. */
export declare function pickAdminKeyFor(account: StoredAccount): AdminKeyEntry | null;
export declare function readUsageCache(adminLabel: string, projectId: string | undefined, maxAgeMs: number): ApiKeyUsageSnapshot | null;
/** Read cached snapshot regardless of TTL (for stale fallback display). */
export declare function readUsageCacheStale(adminLabel: string, projectId: string | undefined): ApiKeyUsageSnapshot | null;
export declare function writeUsageCache(snapshot: ApiKeyUsageSnapshot): void;
/** Save-back the current active auth to the stored account (preserves token rotations) */
export declare function syncActiveToStore(): void;
/**
 * Persist rotated tokens to the stored account, and to `$CODEX_HOME/auth.json`
 * when that account is the one Codex currently has loaded.
 */
export declare function persistAccountAuth(auth: CodexAuthFile): CodexAuthFile;
