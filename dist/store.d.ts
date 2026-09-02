import type { StoredAccount, CodexAuthFile, AdminKeyEntry, ApiKeyUsageSnapshot } from "./types.js";
/** Read an auth.json from a Codex home directory. */
export declare function readAuthFromHome(codexHome: string): CodexAuthFile | null;
/** Read the current active auth from ~/.codex/auth.json */
export declare function readActiveAuth(): CodexAuthFile | null;
/** Write auth to ~/.codex/auth.json (with backup) */
export declare function writeActiveAuth(auth: CodexAuthFile): void;
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
