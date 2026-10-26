import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, renameSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { homedir, userInfo } from "node:os";
import { execFile, execSync } from "node:child_process";
import { ensureStoreDir, STORE_DIR } from "./paths.js";
const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const OAUTH_BETA_HEADER = "oauth-2025-04-20";
const OAUTH_TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
const OAUTH_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const DEFAULT_OAUTH_SCOPES = [
    "user:profile",
    "user:inference",
    "user:sessions:claude_code",
    "user:mcp_servers",
    "user:file_upload",
];
const REFRESH_EARLY_MS = 5 * 60 * 1000;
const PROFILES_PATH = join(STORE_DIR, "claude.json");
const INSTANCES_DIR = join(STORE_DIR, "claude");
const USAGE_CACHE_DIR = join(STORE_DIR, "claude-usage-cache");
const RESERVED_NAMES = new Set(["add", "login", "list", "ls", "switch", "use", "remove", "rm", "env", "status", "run", "help"]);
function sanitizeName(name) {
    return name.replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase();
}
function readProfiles() {
    ensureStoreDir();
    try {
        return JSON.parse(readFileSync(PROFILES_PATH, "utf-8"));
    }
    catch {
        return { profiles: {} };
    }
}
function writeProfiles(data) {
    ensureStoreDir();
    writeFileSync(PROFILES_PATH, JSON.stringify(data, null, 2), { mode: 0o600 });
}
function safeFilename(value) {
    return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}
function usageCachePath(profileName) {
    return join(USAGE_CACHE_DIR, `${safeFilename(profileName)}.json`);
}
export function readClaudeUsageCache(profileName) {
    try {
        return JSON.parse(readFileSync(usageCachePath(profileName), "utf-8"));
    }
    catch {
        return null;
    }
}
export function writeClaudeUsageCache(profileName, entry) {
    ensureStoreDir();
    mkdirSync(USAGE_CACHE_DIR, { recursive: true, mode: 0o700 });
    const path = usageCachePath(profileName);
    const temp = `${path}.tmp-${process.pid}`;
    writeFileSync(temp, JSON.stringify(entry, null, 2), { mode: 0o600 });
    renameSync(temp, path);
}
export function validateProfileName(name) {
    if (!name)
        return "Profile name is required.";
    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(name)) {
        return "Invalid name. Use letters, numbers, dash, underscore. Must start with a letter.";
    }
    if (RESERVED_NAMES.has(name.toLowerCase())) {
        return `"${name}" is a reserved command name.`;
    }
    return null;
}
/** Resolve the instance directory path for a profile.
 *  Uses the stored `dir` field if available, otherwise derives from name. */
export function getInstancePath(name) {
    const data = readProfiles();
    const profile = data.profiles[name];
    const dir = profile?.dir || sanitizeName(name);
    return join(INSTANCES_DIR, dir);
}
/** Initialize an instance directory with Claude-expected subdirectories + MCP sync */
function initInstanceDir(instancePath) {
    ensureStoreDir();
    mkdirSync(instancePath, { recursive: true, mode: 0o700 });
    for (const dir of ["session-env", "todos", "logs", "file-history", "shell-snapshots", "debug", ".anthropic"]) {
        const p = join(instancePath, dir);
        if (!existsSync(p))
            mkdirSync(p, { recursive: true, mode: 0o700 });
    }
    syncMcpServers(instancePath);
    return instancePath;
}
/** Create a named profile with its own instance directory */
export function createProfile(name) {
    const dir = sanitizeName(name);
    const instancePath = initInstanceDir(join(INSTANCES_DIR, dir));
    const data = readProfiles();
    data.profiles[name] = { name, createdAt: new Date().toISOString(), dir };
    if (!data.active)
        data.active = name;
    writeProfiles(data);
    return instancePath;
}
/** Create a temporary instance dir for login before we know the email.
 *  Returns { path, dirName } — the dirName is stable and never renamed. */
export function createTempInstance() {
    const dirName = `_p${Date.now()}`;
    const instancePath = join(INSTANCES_DIR, dirName);
    initInstanceDir(instancePath);
    return { path: instancePath, dirName };
}
/** Register a profile pointing to an existing instance directory (no rename). */
export function registerProfile(name, dirName) {
    const data = readProfiles();
    if (data.profiles[name]) {
        data.profiles[name].lastUsed = new Date().toISOString();
        data.profiles[name].dir = dirName;
    }
    else {
        data.profiles[name] = { name, createdAt: new Date().toISOString(), dir: dirName };
    }
    if (!data.active)
        data.active = name;
    writeProfiles(data);
}
/** Clean up an instance directory by dir name */
export function cleanupInstance(dirName) {
    const p = join(INSTANCES_DIR, dirName);
    if (existsSync(p))
        rmSync(p, { recursive: true, force: true });
}
export function listProfiles() {
    return Object.values(readProfiles().profiles).sort((a, b) => a.name.localeCompare(b.name));
}
export function findProfile(name) {
    return readProfiles().profiles[name] || null;
}
export function removeProfile(name) {
    const data = readProfiles();
    const profile = data.profiles[name];
    if (!profile)
        return false;
    const dir = profile.dir || sanitizeName(name);
    delete data.profiles[name];
    if (data.active === name) {
        const remaining = Object.keys(data.profiles);
        data.active = remaining[0];
    }
    writeProfiles(data);
    const instancePath = join(INSTANCES_DIR, dir);
    if (existsSync(instancePath))
        rmSync(instancePath, { recursive: true, force: true });
    return true;
}
export function getActiveProfile() {
    return readProfiles().active || null;
}
export function setActiveProfile(name) {
    const data = readProfiles();
    if (!data.profiles[name])
        throw new Error(`Profile "${name}" not found`);
    data.active = name;
    data.profiles[name].lastUsed = new Date().toISOString();
    writeProfiles(data);
}
export function detectClaudeCli() {
    try {
        const result = execSync("which claude", {
            encoding: "utf-8",
            stdio: ["ignore", "pipe", "ignore"],
            timeout: 5000,
        }).trim();
        return result || null;
    }
    catch {
        return null;
    }
}
/** Get auth status by running `claude auth status` with a given CLAUDE_CONFIG_DIR */
export function getAuthStatusForPath(instancePath) {
    const claudePath = detectClaudeCli();
    if (!claudePath)
        return Promise.resolve(null);
    if (!existsSync(instancePath))
        return Promise.resolve(null);
    return new Promise((resolve) => {
        execFile(claudePath, ["auth", "status"], {
            encoding: "utf-8",
            timeout: 10000,
            env: { ...process.env, CLAUDE_CONFIG_DIR: instancePath },
        }, (_error, stdout) => {
            const output = (stdout || "").trim();
            if (!output) {
                resolve(null);
                return;
            }
            try {
                const parsed = JSON.parse(output);
                if (typeof parsed.loggedIn === "boolean") {
                    resolve({
                        loggedIn: parsed.loggedIn,
                        authMethod: parsed.authMethod ?? null,
                        apiProvider: parsed.apiProvider ?? null,
                        email: parsed.email ?? null,
                        orgId: parsed.orgId ?? null,
                        orgName: parsed.orgName ?? null,
                        subscriptionType: parsed.subscriptionType ?? null,
                    });
                    return;
                }
            }
            catch { /* ignore parse errors */ }
            resolve(null);
        });
    });
}
/** Get auth status for a named profile */
export function getAuthStatusAsync(name) {
    return getAuthStatusForPath(getInstancePath(name));
}
/** Compute the Keychain service suffix for a CLAUDE_CONFIG_DIR path */
function keychainHash(instancePath) {
    return createHash("sha256").update(instancePath).digest("hex").slice(0, 8);
}
const KEYCHAIN_SERVICE_BASE = "Claude Code-credentials";
/** Config directory Claude Code uses when CLAUDE_CONFIG_DIR is unset. */
export function defaultClaudeConfigDir() {
    return join(homedir(), ".claude");
}
/** Home-level account file Claude Code uses when CLAUDE_CONFIG_DIR is unset. */
export function defaultClaudeAccountFile() {
    return join(homedir(), ".claude.json");
}
/**
 * macOS Keychain service for a Claude config directory.
 * An unset CLAUDE_CONFIG_DIR uses the unhashed name. Setting the variable,
 * even to the default path, selects the hashed name instead.
 */
export function claudeKeychainService(configDir, isolated) {
    if (!isolated)
        return KEYCHAIN_SERVICE_BASE;
    return `${KEYCHAIN_SERVICE_BASE}-${keychainHash(configDir)}`;
}
function isDefaultClaudeConfig(configDir) {
    return resolve(configDir) === resolve(defaultClaudeConfigDir());
}
/** Account name Claude Code uses for the default Keychain item. */
function claudeKeychainAccount() {
    let name = "claude-code-user";
    try {
        name = process.env.USER || userInfo().username;
    }
    catch {
        // Keep the fallback Claude uses when the user name cannot be read.
    }
    return /^[a-zA-Z0-9._-]+$/.test(name) ? name : "claude-code-user";
}
export function readOauthEmail(claudeJsonPath) {
    try {
        const data = JSON.parse(readFileSync(claudeJsonPath, "utf-8"));
        const email = data.oauthAccount?.emailAddress;
        return typeof email === "string" && email.includes("@") ? email : null;
    }
    catch {
        return null;
    }
}
/** Copy the profile's oauthAccount into Claude's home account file. Other keys are kept. */
export function syncOauthAccount(instancePath, accountFile) {
    let source;
    try {
        const parsed = JSON.parse(readFileSync(join(instancePath, ".claude.json"), "utf-8"));
        if (!parsed.oauthAccount || typeof parsed.oauthAccount !== "object" || Array.isArray(parsed.oauthAccount)) {
            return false;
        }
        source = parsed.oauthAccount;
    }
    catch {
        return false;
    }
    let dest = {};
    if (existsSync(accountFile)) {
        try {
            const parsed = JSON.parse(readFileSync(accountFile, "utf-8"));
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
                dest = parsed;
        }
        catch {
            dest = {};
        }
    }
    const current = dest.oauthAccount && typeof dest.oauthAccount === "object" && !Array.isArray(dest.oauthAccount)
        ? dest.oauthAccount
        : undefined;
    const sameAccount = !!current
        && typeof current.emailAddress === "string"
        && typeof source.emailAddress === "string"
        && current.emailAddress.toLowerCase() === source.emailAddress.toLowerCase()
        && (typeof current.accountUuid !== "string"
            || typeof source.accountUuid !== "string"
            || current.accountUuid === source.accountUuid);
    if (sameAccount || JSON.stringify(dest.oauthAccount) === JSON.stringify(source))
        return false;
    dest.oauthAccount = source;
    const mode = existsSync(accountFile) ? statSync(accountFile).mode & 0o777 : 0o600;
    mkdirSync(dirname(accountFile), { recursive: true, mode: 0o700 });
    const temp = `${accountFile}.tmp-${process.pid}`;
    writeFileSync(temp, JSON.stringify(dest, null, 2), { mode });
    renameSync(temp, accountFile);
    return true;
}
function credentialFromPayload(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload))
        return null;
    const oauth = payload.claudeAiOauth;
    if (!oauth || typeof oauth !== "object" || Array.isArray(oauth))
        return null;
    const record = oauth;
    return {
        accessToken: typeof record.accessToken === "string" ? record.accessToken : undefined,
        refreshToken: typeof record.refreshToken === "string" ? record.refreshToken : undefined,
        subscriptionType: typeof record.subscriptionType === "string" ? record.subscriptionType : undefined,
        rateLimitTier: typeof record.rateLimitTier === "string" ? record.rateLimitTier : undefined,
        expiresAt: typeof record.expiresAt === "number" ? record.expiresAt : undefined,
        refreshTokenExpiresAt: typeof record.refreshTokenExpiresAt === "number" ? record.refreshTokenExpiresAt : undefined,
        scopes: Array.isArray(record.scopes) ? record.scopes.filter((scope) => typeof scope === "string") : undefined,
        clientId: typeof record.clientId === "string" ? record.clientId : undefined,
    };
}
function readCredentialFile(instancePath) {
    const credPath = join(instancePath, ".credentials.json");
    if (!existsSync(credPath))
        return null;
    try {
        return credentialFromPayload(JSON.parse(readFileSync(credPath, "utf-8")));
    }
    catch {
        return null;
    }
}
function runSecurity(args) {
    return new Promise((resolve, reject) => {
        execFile("security", args, { encoding: "utf-8", timeout: 5000 }, (error, stdout) => {
            if (error)
                reject(error);
            else
                resolve({ stdout: stdout ?? "" });
        });
    });
}
async function readKeychainPayload(service, account, security = runSecurity) {
    try {
        const { stdout } = await security(["find-generic-password", "-s", service, "-a", account, "-w"]);
        if (!stdout.trim())
            return null;
        const parsed = JSON.parse(stdout.trim());
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
            return null;
        return parsed;
    }
    catch {
        return null;
    }
}
/** Read Claude credential from macOS Keychain or .credentials.json fallback */
export async function readCredential(instancePath) {
    // Claude prefers the unhashed Keychain item when CLAUDE_CONFIG_DIR is unset,
    // and ignores a newer plaintext file sitting beside a stale item.
    if (process.platform === "darwin" && isDefaultClaudeConfig(instancePath)) {
        const keychain = await readKeychainPayload(claudeKeychainService(instancePath, false), claudeKeychainAccount());
        const fromKeychain = credentialFromPayload(keychain);
        if (fromKeychain)
            return fromKeychain;
    }
    const fromFile = readCredentialFile(instancePath);
    if (fromFile)
        return fromFile;
    if (process.platform !== "darwin" || isDefaultClaudeConfig(instancePath))
        return null;
    const keychain = await readKeychainPayload(claudeKeychainService(instancePath, true), userInfo().username);
    return credentialFromPayload(keychain);
}
async function readCredentialPayload(instancePath) {
    if (process.platform === "darwin" && isDefaultClaudeConfig(instancePath)) {
        const keychain = await readKeychainPayload(claudeKeychainService(instancePath, false), claudeKeychainAccount());
        if (keychain?.claudeAiOauth)
            return keychain;
    }
    const credPath = join(instancePath, ".credentials.json");
    if (existsSync(credPath)) {
        return JSON.parse(readFileSync(credPath, "utf-8"));
    }
    if (process.platform !== "darwin" || isDefaultClaudeConfig(instancePath))
        return {};
    const keychain = await readKeychainPayload(claudeKeychainService(instancePath, true), userInfo().username);
    if (!keychain)
        throw new Error("Claude credential not found");
    return keychain;
}
async function writeCredentialPayload(instancePath, payload) {
    const serialized = JSON.stringify(payload, null, 2);
    const credPath = join(instancePath, ".credentials.json");
    if (existsSync(credPath) || process.platform !== "darwin") {
        const temp = `${credPath}.tmp-${process.pid}`;
        writeFileSync(temp, serialized, { mode: 0o600 });
        renameSync(temp, credPath);
        return;
    }
    await writeKeychainLogin(instancePath, payload, { defaultLogin: false });
}
function writeCredentialFile(targetDir, payload) {
    mkdirSync(targetDir, { recursive: true, mode: 0o700 });
    const credPath = join(targetDir, ".credentials.json");
    const temp = `${credPath}.tmp-${process.pid}`;
    writeFileSync(temp, JSON.stringify(payload, null, 2), { mode: 0o600 });
    renameSync(temp, credPath);
}
async function writeKeychainLogin(targetDir, payload, options) {
    const security = options.security ?? runSecurity;
    const isolated = options.defaultLogin === true ? false
        : options.defaultLogin === false ? true
            : !isDefaultClaudeConfig(targetDir);
    const service = claudeKeychainService(targetDir, isolated);
    const account = isolated ? userInfo().username : claudeKeychainAccount();
    let merged = payload;
    const existing = await readKeychainPayload(service, account, security);
    if (existing)
        merged = { ...existing, ...payload };
    await security(["add-generic-password", "-U", "-s", service, "-a", account, "-w", JSON.stringify(merged)]);
    return merged;
}
/** Write a Claude OAuth payload where Claude Code will read it for this config directory. */
export async function writeClaudeLogin(targetDir, payload, options = {}) {
    const platform = options.platform ?? process.platform;
    let stored = payload;
    if (platform === "darwin") {
        stored = await writeKeychainLogin(targetDir, payload, options);
    }
    writeCredentialFile(targetDir, stored);
}
/** Make Claude Code's default login match a stored profile. */
export async function installClaudeLogin(instancePath, targetDir = defaultClaudeConfigDir()) {
    const payload = await readCredentialPayload(instancePath);
    if (!credentialFromPayload(payload)?.accessToken) {
        throw new Error("Claude profile has no OAuth login to activate");
    }
    const defaultLogin = isDefaultClaudeConfig(targetDir);
    await writeClaudeLogin(targetDir, payload, { defaultLogin });
    if (defaultLogin)
        syncOauthAccount(instancePath, defaultClaudeAccountFile());
}
function systemLoginLocations(options) {
    return {
        configDir: options?.systemConfigDir ?? defaultClaudeConfigDir(),
        accountFile: options?.systemAccountFile ?? defaultClaudeAccountFile(),
    };
}
/**
 * Keep the default Claude login and this profile on the same refresh token
 * when they are the same account. Claude rotates the refresh token in
 * ~/.claude when it refreshes; copying only one way would sign the other out.
 * A different account on the default login is left alone.
 */
async function reconcileWithSystemLogin(instancePath, options) {
    const profileEmail = readOauthEmail(join(instancePath, ".claude.json"));
    if (!profileEmail)
        return;
    const { configDir, accountFile } = systemLoginLocations(options);
    const systemEmail = readOauthEmail(accountFile);
    if (!systemEmail || systemEmail.toLowerCase() !== profileEmail.toLowerCase())
        return;
    const profile = await readCredential(instancePath);
    const system = await readCredential(configDir);
    if (!profile?.refreshToken || !system?.refreshToken || profile.refreshToken === system.refreshToken)
        return;
    if ((system.expiresAt ?? 0) > (profile.expiresAt ?? 0)) {
        await writeCredentialPayload(instancePath, await readCredentialPayload(configDir));
        return;
    }
    await writeClaudeLogin(configDir, await readCredentialPayload(instancePath), {
        defaultLogin: isDefaultClaudeConfig(configDir),
    });
}
/** Refresh an expiring Claude OAuth credential and persist any rotated tokens. */
export async function ensureFreshClaudeCredential(instancePath, credential, fetchImpl = fetch, options) {
    try {
        await reconcileWithSystemLogin(instancePath, options);
    }
    catch {
        // A profile refresh should still succeed when the default login cannot be updated.
    }
    const adopted = await readCredential(instancePath);
    const newest = (adopted?.expiresAt ?? 0) >= (credential.expiresAt ?? 0) ? (adopted ?? credential) : credential;
    if (newest.expiresAt && newest.expiresAt > Date.now() + REFRESH_EARLY_MS)
        return newest;
    // A concurrent Claude process may already have refreshed the file.
    const latest = await readCredential(instancePath);
    if (latest?.expiresAt && latest.expiresAt > Date.now() + REFRESH_EARLY_MS)
        return latest;
    const current = latest ?? credential;
    if (!current.refreshToken)
        throw new Error("Claude OAuth token expired and no refresh token is available; run 'aacc claude run' and /login");
    if (current.refreshTokenExpiresAt && current.refreshTokenExpiresAt <= Date.now()) {
        throw new Error("Claude OAuth refresh token expired; run 'aacc claude run' and /login");
    }
    const scopes = current.scopes?.length ? current.scopes : DEFAULT_OAUTH_SCOPES;
    const res = await fetchImpl(OAUTH_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            grant_type: "refresh_token",
            refresh_token: current.refreshToken,
            client_id: current.clientId ?? OAUTH_CLIENT_ID,
            scope: scopes.join(" "),
        }),
        signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
        // If another process won a refresh-token rotation race, prefer its newer file.
        const concurrent = await readCredential(instancePath);
        if (concurrent?.expiresAt && concurrent.expiresAt > Date.now() + REFRESH_EARLY_MS)
            return concurrent;
        throw new Error(`Claude OAuth refresh failed (${res.status} ${res.statusText})`);
    }
    const token = await res.json();
    if (!token.access_token || typeof token.expires_in !== "number") {
        throw new Error("Claude OAuth refresh returned an incomplete token response");
    }
    const refreshed = {
        ...current,
        accessToken: token.access_token,
        refreshToken: token.refresh_token ?? current.refreshToken,
        expiresAt: Date.now() + token.expires_in * 1000,
        refreshTokenExpiresAt: typeof token.refresh_token_expires_in === "number"
            ? Date.now() + token.refresh_token_expires_in * 1000
            : current.refreshTokenExpiresAt,
        scopes: token.scope ? token.scope.split(" ").filter(Boolean) : scopes,
    };
    const payload = await readCredentialPayload(instancePath);
    const existingOauth = payload.claudeAiOauth && typeof payload.claudeAiOauth === "object"
        ? payload.claudeAiOauth
        : {};
    payload.claudeAiOauth = { ...existingOauth, ...refreshed };
    await writeCredentialPayload(instancePath, payload);
    try {
        await reconcileWithSystemLogin(instancePath, options);
    }
    catch {
        // The rotated profile token is saved. The default login is updated on the next switch.
    }
    return refreshed;
}
export class ClaudeUsageError extends Error {
    status;
    retryAfterSeconds;
    constructor(message, status, retryAfterSeconds) {
        super(message);
        this.status = status;
        this.retryAfterSeconds = retryAfterSeconds;
        this.name = "ClaudeUsageError";
    }
}
/** Fetch rate limit utilization from /api/oauth/usage */
export async function fetchClaudeUsage(accessToken, fetchImpl = fetch) {
    try {
        const res = await fetchImpl(USAGE_URL, {
            headers: {
                "Authorization": `Bearer ${accessToken}`,
                "anthropic-beta": OAUTH_BETA_HEADER,
                "Content-Type": "application/json",
            },
            signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) {
            const retryAfter = Number.parseInt(res.headers.get("retry-after") ?? "", 10);
            throw new ClaudeUsageError(`Claude usage request failed (${res.status} ${res.statusText})`, res.status, Number.isFinite(retryAfter) ? retryAfter : undefined);
        }
        const body = await res.json();
        if (!body || typeof body !== "object" || Array.isArray(body)) {
            throw new ClaudeUsageError("Claude usage request returned an invalid response");
        }
        return body;
    }
    catch (error) {
        if (error instanceof ClaudeUsageError)
            throw error;
        throw new ClaudeUsageError(`Claude usage request failed: ${error.message}`);
    }
}
/** Copy MCP server config from global ~/.claude.json into the instance */
function syncMcpServers(instancePath) {
    const globalClaudeJson = join(homedir(), ".claude.json");
    if (!existsSync(globalClaudeJson))
        return;
    try {
        const global = JSON.parse(readFileSync(globalClaudeJson, "utf-8"));
        const mcp = global.mcpServers;
        if (!mcp || typeof mcp !== "object" || Array.isArray(mcp) || Object.keys(mcp).length === 0)
            return;
        const instanceJson = join(instancePath, ".claude.json");
        let content = {};
        if (existsSync(instanceJson)) {
            try {
                content = JSON.parse(readFileSync(instanceJson, "utf-8"));
            }
            catch {
                content = {};
            }
        }
        const existing = content.mcpServers && typeof content.mcpServers === "object" && !Array.isArray(content.mcpServers)
            ? content.mcpServers : {};
        content.mcpServers = { ...mcp, ...existing };
        writeFileSync(instanceJson, JSON.stringify(content, null, 2), { mode: 0o600 });
    }
    catch {
        // Best-effort
    }
}
//# sourceMappingURL=claude-store.js.map