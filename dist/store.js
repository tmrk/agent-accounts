import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync, existsSync, renameSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { extractEmail } from "./jwt.js";
import { ensureStoreDir, STORE_DIR } from "./paths.js";
const ACCOUNTS_DIR = join(STORE_DIR, "accounts");
const ADMIN_KEYS_DIR = join(STORE_DIR, "admin-keys");
const USAGE_CACHE_DIR = join(STORE_DIR, "usage-cache");
const FILE_CREDENTIAL_STORE_LINE = 'cli_auth_credentials_store = "file"';
/** Codex home: `$CODEX_HOME` when set, otherwise `~/.codex`. */
export function getCodexHome() {
    const fromEnv = process.env.CODEX_HOME?.trim();
    return fromEnv ? fromEnv : join(homedir(), ".codex");
}
export function getCodexAuthPath() {
    return join(getCodexHome(), "auth.json");
}
export function getCodexConfigPath() {
    return join(getCodexHome(), "config.toml");
}
/** Whether auth.json is Codex's configured credential source. The default is file. */
export function usesCodexFileCredentialStore() {
    let config;
    try {
        config = readFileSync(getCodexConfigPath(), "utf-8");
    }
    catch {
        return true;
    }
    for (const line of config.split("\n")) {
        if (/^\s*\[/.test(line))
            break;
        const match = /^\s*cli_auth_credentials_store\s*=\s*["']?([a-z]+)["']?(?:\s*#.*)?\s*$/.exec(line);
        if (match)
            return match[1] === "file";
    }
    return true;
}
function emailFromAuth(auth) {
    if (!auth?.tokens?.id_token)
        return undefined;
    try {
        return extractEmail(auth.tokens.id_token);
    }
    catch {
        return undefined;
    }
}
function ensureDirs() {
    ensureStoreDir();
    mkdirSync(ACCOUNTS_DIR, { recursive: true });
}
function ensureAdminDirs() {
    ensureStoreDir();
    mkdirSync(ADMIN_KEYS_DIR, { recursive: true });
}
function ensureUsageCacheDir() {
    ensureStoreDir();
    mkdirSync(USAGE_CACHE_DIR, { recursive: true });
}
function safeFilename(s) {
    return s.replace(/[^a-zA-Z0-9._-]/g, "_");
}
/** Sanitize email for use as filename */
function emailToFilename(email) {
    return email.replace(/[^a-zA-Z0-9._@-]/g, "_") + ".json";
}
/** Read an auth.json from a Codex home directory. */
export function readAuthFromHome(codexHome) {
    try {
        const raw = readFileSync(join(codexHome, "auth.json"), "utf-8");
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
/** Read the current active auth from `$CODEX_HOME/auth.json`. */
export function readActiveAuth() {
    return readAuthFromHome(getCodexHome());
}
function atomicWrite(path, contents, mode = 0o600) {
    const tmpPath = `${path}.tmp`;
    writeFileSync(tmpPath, contents, { mode });
    renameSync(tmpPath, path);
}
/**
 * Pin Codex to file-backed credentials so account switches via auth.json take
 * effect. `auto`/`keyring` keep the OS keyring as source of truth, which makes
 * the dashboard look switched while `codex` still uses the previous login.
 *
 * Only rewrites the top-level `cli_auth_credentials_store` key; profile tables
 * are left alone. Returns true when config.toml was created or changed.
 */
export function applyFileCredentialStore(configToml) {
    const lines = configToml.split("\n").map(line => line.replace(/\r$/, ""));
    let inTable = false;
    let foundTopLevel = false;
    let changed = false;
    const out = [];
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("[") && /^\[+[^#\]]/.test(trimmed)) {
            inTable = true;
        }
        if (!inTable) {
            const indent = line.match(/^(\s*)cli_auth_credentials_store\s*=/)?.[1];
            if (indent !== undefined) {
                foundTopLevel = true;
                const alreadyFile = /^\s*cli_auth_credentials_store\s*=\s*["']?file["']?\s*(?:#.*)?$/.test(line);
                if (alreadyFile) {
                    out.push(line);
                }
                else {
                    out.push(`${indent}${FILE_CREDENTIAL_STORE_LINE}`);
                    changed = true;
                }
                continue;
            }
        }
        out.push(line);
    }
    if (!foundTopLevel) {
        const body = out.join("\n").replace(/^\n+/, "");
        const text = body.trim() === "" ? `${FILE_CREDENTIAL_STORE_LINE}\n` : `${FILE_CREDENTIAL_STORE_LINE}\n\n${body}`;
        return { text, changed: true };
    }
    return { text: out.join("\n"), changed };
}
export function ensureCodexFileCredentialStore() {
    const home = getCodexHome();
    mkdirSync(home, { recursive: true, mode: 0o700 });
    const path = getCodexConfigPath();
    let current = "";
    try {
        current = readFileSync(path, "utf-8");
    }
    catch {
        current = "";
    }
    const { text, changed } = applyFileCredentialStore(current);
    if (!changed)
        return false;
    atomicWrite(path, text.endsWith("\n") ? text : `${text}\n`);
    return true;
}
/** Write auth to `$CODEX_HOME/auth.json` (with backup). */
export function writeActiveAuth(auth) {
    const home = getCodexHome();
    mkdirSync(home, { recursive: true, mode: 0o700 });
    const authPath = getCodexAuthPath();
    const payload = auth.auth_mode === "apikey"
        ? { auth_mode: "apikey", OPENAI_API_KEY: auth.OPENAI_API_KEY ?? "" }
        : auth;
    const tmpPath = `${authPath}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(payload, null, 2), { mode: 0o600 });
    if (existsSync(authPath)) {
        try {
            copyFileSync(authPath, `${authPath}.bak`);
        }
        catch {
            // Ignore backup failures
        }
    }
    renameSync(tmpPath, authPath);
}
/** Pin the file credential store and write the auth Codex will load on the next process. */
export function activateAuthOnSystem(auth) {
    ensureCodexFileCredentialStore();
    writeActiveAuth(auth);
}
/** Save an account to the store */
export function saveAccount(account) {
    ensureDirs();
    const filename = emailToFilename(account.email);
    const filepath = join(ACCOUNTS_DIR, filename);
    writeFileSync(filepath, JSON.stringify(account, null, 2), { mode: 0o600 });
}
/** List all stored accounts */
export function listAccounts() {
    ensureDirs();
    const files = readdirSync(ACCOUNTS_DIR).filter(f => f.endsWith(".json"));
    const accounts = [];
    for (const file of files) {
        try {
            const raw = readFileSync(join(ACCOUNTS_DIR, file), "utf-8");
            accounts.push(JSON.parse(raw));
        }
        catch {
            // Skip corrupted files
        }
    }
    return accounts.sort((a, b) => a.email.localeCompare(b.email));
}
/** Find a stored account by email */
export function findAccount(email) {
    const filename = emailToFilename(email);
    const filepath = join(ACCOUNTS_DIR, filename);
    try {
        const raw = readFileSync(filepath, "utf-8");
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
/** Remove an account from the store */
export function removeAccount(email) {
    const filename = emailToFilename(email);
    const filepath = join(ACCOUNTS_DIR, filename);
    try {
        unlinkSync(filepath);
        return true;
    }
    catch {
        return false;
    }
}
/** Detect which stored account is currently active */
export function detectActiveAccount() {
    if (!usesCodexFileCredentialStore())
        return null;
    const active = readActiveAuth();
    if (!active)
        return null;
    const email = emailFromAuth(active);
    if (email && findAccount(email))
        return email;
    if (active.OPENAI_API_KEY) {
        const accounts = listAccounts();
        const match = accounts.find(a => a.auth.OPENAI_API_KEY === active.OPENAI_API_KEY);
        if (match)
            return match.email;
    }
    return null;
}
// --- Admin keys (sk-admin-*) ---
export function listAdminKeys() {
    ensureAdminDirs();
    const files = readdirSync(ADMIN_KEYS_DIR).filter(f => f.endsWith(".json"));
    const out = [];
    for (const file of files) {
        try {
            const raw = readFileSync(join(ADMIN_KEYS_DIR, file), "utf-8");
            out.push(JSON.parse(raw));
        }
        catch {
            // skip
        }
    }
    return out.sort((a, b) => a.label.localeCompare(b.label));
}
export function findAdminKey(label) {
    const path = join(ADMIN_KEYS_DIR, safeFilename(label) + ".json");
    try {
        return JSON.parse(readFileSync(path, "utf-8"));
    }
    catch {
        return null;
    }
}
export function saveAdminKey(entry) {
    ensureAdminDirs();
    const path = join(ADMIN_KEYS_DIR, safeFilename(entry.label) + ".json");
    writeFileSync(path, JSON.stringify(entry, null, 2), { mode: 0o600 });
}
export function removeAdminKey(label) {
    const path = join(ADMIN_KEYS_DIR, safeFilename(label) + ".json");
    try {
        unlinkSync(path);
        return true;
    }
    catch {
        return false;
    }
}
/** Pick the admin key to use for an API-key account. */
export function pickAdminKeyFor(account) {
    if (account.adminKeyLabel) {
        const named = findAdminKey(account.adminKeyLabel);
        if (named)
            return named;
    }
    const all = listAdminKeys();
    return all[0] ?? null;
}
function usageCachePath(adminLabel, projectId) {
    const key = `${safeFilename(adminLabel)}__${safeFilename(projectId ?? "all")}.json`;
    return join(USAGE_CACHE_DIR, key);
}
export function readUsageCache(adminLabel, projectId, maxAgeMs) {
    ensureUsageCacheDir();
    const path = usageCachePath(adminLabel, projectId);
    try {
        const raw = readFileSync(path, "utf-8");
        const cached = JSON.parse(raw);
        const age = Date.now() - new Date(cached.fetchedAt).getTime();
        if (age > maxAgeMs)
            return null;
        return cached.snapshot;
    }
    catch {
        return null;
    }
}
/** Read cached snapshot regardless of TTL (for stale fallback display). */
export function readUsageCacheStale(adminLabel, projectId) {
    ensureUsageCacheDir();
    const path = usageCachePath(adminLabel, projectId);
    try {
        const raw = readFileSync(path, "utf-8");
        const cached = JSON.parse(raw);
        return cached.snapshot;
    }
    catch {
        return null;
    }
}
export function writeUsageCache(snapshot) {
    ensureUsageCacheDir();
    const path = usageCachePath(snapshot.adminKeyLabel, snapshot.projectId);
    const payload = { fetchedAt: snapshot.fetchedAt, snapshot };
    writeFileSync(path, JSON.stringify(payload, null, 2), { mode: 0o600 });
}
/** Save-back the current active auth to the stored account (preserves token rotations) */
export function syncActiveToStore() {
    if (!usesCodexFileCredentialStore())
        return;
    const active = readActiveAuth();
    if (!active)
        return;
    const email = emailFromAuth(active);
    if (email) {
        const existing = findAccount(email);
        if (existing) {
            existing.auth = active;
            saveAccount(existing);
        }
        return;
    }
    if (active.OPENAI_API_KEY) {
        const match = listAccounts().find(a => a.auth.OPENAI_API_KEY === active.OPENAI_API_KEY);
        if (match) {
            match.auth = active;
            saveAccount(match);
        }
    }
}
/**
 * Persist rotated tokens to the stored account, and to `$CODEX_HOME/auth.json`
 * when that account is the one Codex currently has loaded.
 */
export function persistAccountAuth(auth) {
    const email = emailFromAuth(auth);
    if (email) {
        const existing = findAccount(email);
        if (existing) {
            existing.auth = auth;
            saveAccount(existing);
        }
        if (usesCodexFileCredentialStore() && emailFromAuth(readActiveAuth()) === email)
            writeActiveAuth(auth);
        return auth;
    }
    if (auth.OPENAI_API_KEY) {
        const match = listAccounts().find(a => a.auth.OPENAI_API_KEY === auth.OPENAI_API_KEY);
        if (match) {
            match.auth = auth;
            saveAccount(match);
        }
        if (usesCodexFileCredentialStore() && readActiveAuth()?.OPENAI_API_KEY === auth.OPENAI_API_KEY)
            writeActiveAuth(auth);
    }
    return auth;
}
//# sourceMappingURL=store.js.map