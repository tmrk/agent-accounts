import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync, existsSync, renameSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { StoredAccount, CodexAuthFile, AdminKeyEntry, ApiKeyUsageSnapshot } from "./types.js";
import { extractEmail } from "./jwt.js";
import { ensureStoreDir, STORE_DIR } from "./paths.js";

const ACCOUNTS_DIR = join(STORE_DIR, "accounts");
const ADMIN_KEYS_DIR = join(STORE_DIR, "admin-keys");
const USAGE_CACHE_DIR = join(STORE_DIR, "usage-cache");
const CODEX_AUTH_PATH = join(homedir(), ".codex", "auth.json");

function ensureDirs(): void {
  ensureStoreDir();
  mkdirSync(ACCOUNTS_DIR, { recursive: true });
}

function ensureAdminDirs(): void {
  ensureStoreDir();
  mkdirSync(ADMIN_KEYS_DIR, { recursive: true });
}

function ensureUsageCacheDir(): void {
  ensureStoreDir();
  mkdirSync(USAGE_CACHE_DIR, { recursive: true });
}

function safeFilename(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/** Sanitize email for use as filename */
function emailToFilename(email: string): string {
  return email.replace(/[^a-zA-Z0-9._@-]/g, "_") + ".json";
}

/** Read an auth.json from a Codex home directory. */
export function readAuthFromHome(codexHome: string): CodexAuthFile | null {
  try {
    const raw = readFileSync(join(codexHome, "auth.json"), "utf-8");
    return JSON.parse(raw) as CodexAuthFile;
  } catch {
    return null;
  }
}

/** Read the current active auth from ~/.codex/auth.json */
export function readActiveAuth(): CodexAuthFile | null {
  return readAuthFromHome(join(homedir(), ".codex"));
}

/** Write auth to ~/.codex/auth.json (with backup) */
export function writeActiveAuth(auth: CodexAuthFile): void {
  // Backup existing
  if (existsSync(CODEX_AUTH_PATH)) {
    const backupPath = CODEX_AUTH_PATH + ".bak";
    try {
      renameSync(CODEX_AUTH_PATH, backupPath);
    } catch {
      // Ignore backup failures
    }
  }
  // Codex 0.125+ rejects auth.json when tokens.id_token is an empty string.
  // For API key mode, strip the tokens block entirely and emit only the
  // fields codex itself writes via `codex login --with-api-key`.
  const payload =
    auth.auth_mode === "apikey"
      ? { auth_mode: "apikey", OPENAI_API_KEY: auth.OPENAI_API_KEY ?? "" }
      : auth;
  // Atomic write via temp file
  const tmpPath = CODEX_AUTH_PATH + ".tmp";
  writeFileSync(tmpPath, JSON.stringify(payload, null, 2), { mode: 0o600 });
  renameSync(tmpPath, CODEX_AUTH_PATH);
}

/** Save an account to the store */
export function saveAccount(account: StoredAccount): void {
  ensureDirs();
  const filename = emailToFilename(account.email);
  const filepath = join(ACCOUNTS_DIR, filename);
  writeFileSync(filepath, JSON.stringify(account, null, 2), { mode: 0o600 });
}

/** List all stored accounts */
export function listAccounts(): StoredAccount[] {
  ensureDirs();
  const files = readdirSync(ACCOUNTS_DIR).filter(f => f.endsWith(".json"));
  const accounts: StoredAccount[] = [];
  for (const file of files) {
    try {
      const raw = readFileSync(join(ACCOUNTS_DIR, file), "utf-8");
      accounts.push(JSON.parse(raw) as StoredAccount);
    } catch {
      // Skip corrupted files
    }
  }
  return accounts.sort((a, b) => a.email.localeCompare(b.email));
}

/** Find a stored account by email */
export function findAccount(email: string): StoredAccount | null {
  const filename = emailToFilename(email);
  const filepath = join(ACCOUNTS_DIR, filename);
  try {
    const raw = readFileSync(filepath, "utf-8");
    return JSON.parse(raw) as StoredAccount;
  } catch {
    return null;
  }
}

/** Remove an account from the store */
export function removeAccount(email: string): boolean {
  const filename = emailToFilename(email);
  const filepath = join(ACCOUNTS_DIR, filename);
  try {
    unlinkSync(filepath);
    return true;
  } catch {
    return false;
  }
}

/** Detect which stored account is currently active */
export function detectActiveAccount(): string | null {
  const active = readActiveAuth();
  if (!active) return null;

  // OAuth account: match by email from id_token
  if (active.tokens?.id_token) {
    const email = extractEmail(active.tokens.id_token);
    if (email && findAccount(email)) return email;
  }

  // API key account: match by key prefix
  if (active.OPENAI_API_KEY) {
    const accounts = listAccounts();
    const match = accounts.find(a => a.auth.OPENAI_API_KEY === active.OPENAI_API_KEY);
    if (match) return match.email;
  }

  return null;
}

// --- Admin keys (sk-admin-*) ---

export function listAdminKeys(): AdminKeyEntry[] {
  ensureAdminDirs();
  const files = readdirSync(ADMIN_KEYS_DIR).filter(f => f.endsWith(".json"));
  const out: AdminKeyEntry[] = [];
  for (const file of files) {
    try {
      const raw = readFileSync(join(ADMIN_KEYS_DIR, file), "utf-8");
      out.push(JSON.parse(raw) as AdminKeyEntry);
    } catch {
      // skip
    }
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

export function findAdminKey(label: string): AdminKeyEntry | null {
  const path = join(ADMIN_KEYS_DIR, safeFilename(label) + ".json");
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as AdminKeyEntry;
  } catch {
    return null;
  }
}

export function saveAdminKey(entry: AdminKeyEntry): void {
  ensureAdminDirs();
  const path = join(ADMIN_KEYS_DIR, safeFilename(entry.label) + ".json");
  writeFileSync(path, JSON.stringify(entry, null, 2), { mode: 0o600 });
}

export function removeAdminKey(label: string): boolean {
  const path = join(ADMIN_KEYS_DIR, safeFilename(label) + ".json");
  try {
    unlinkSync(path);
    return true;
  } catch {
    return false;
  }
}

/** Pick the admin key to use for an API-key account. */
export function pickAdminKeyFor(account: StoredAccount): AdminKeyEntry | null {
  if (account.adminKeyLabel) {
    const named = findAdminKey(account.adminKeyLabel);
    if (named) return named;
  }
  const all = listAdminKeys();
  return all[0] ?? null;
}

// --- Usage cache ---

interface CachedSnapshot {
  fetchedAt: string;
  snapshot: ApiKeyUsageSnapshot;
}

function usageCachePath(adminLabel: string, projectId: string | undefined): string {
  const key = `${safeFilename(adminLabel)}__${safeFilename(projectId ?? "all")}.json`;
  return join(USAGE_CACHE_DIR, key);
}

export function readUsageCache(
  adminLabel: string,
  projectId: string | undefined,
  maxAgeMs: number,
): ApiKeyUsageSnapshot | null {
  ensureUsageCacheDir();
  const path = usageCachePath(adminLabel, projectId);
  try {
    const raw = readFileSync(path, "utf-8");
    const cached = JSON.parse(raw) as CachedSnapshot;
    const age = Date.now() - new Date(cached.fetchedAt).getTime();
    if (age > maxAgeMs) return null;
    return cached.snapshot;
  } catch {
    return null;
  }
}

/** Read cached snapshot regardless of TTL (for stale fallback display). */
export function readUsageCacheStale(
  adminLabel: string,
  projectId: string | undefined,
): ApiKeyUsageSnapshot | null {
  ensureUsageCacheDir();
  const path = usageCachePath(adminLabel, projectId);
  try {
    const raw = readFileSync(path, "utf-8");
    const cached = JSON.parse(raw) as CachedSnapshot;
    return cached.snapshot;
  } catch {
    return null;
  }
}

export function writeUsageCache(snapshot: ApiKeyUsageSnapshot): void {
  ensureUsageCacheDir();
  const path = usageCachePath(snapshot.adminKeyLabel, snapshot.projectId);
  const payload: CachedSnapshot = { fetchedAt: snapshot.fetchedAt, snapshot };
  writeFileSync(path, JSON.stringify(payload, null, 2), { mode: 0o600 });
}

/** Save-back the current active auth to the stored account (preserves token rotations) */
export function syncActiveToStore(): void {
  const active = readActiveAuth();
  if (!active) return;

  if (active.tokens?.id_token) {
    const email = extractEmail(active.tokens.id_token);
    if (!email) return;
    const existing = findAccount(email);
    if (existing) {
      existing.auth = active;
      saveAccount(existing);
    }
  }
}
