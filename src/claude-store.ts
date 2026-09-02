import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, renameSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { homedir, userInfo } from "node:os";
import { execFile, execSync } from "node:child_process";
import type { ClaudeProfilesFile, ClaudeProfile, ClaudeAuthStatus, ClaudeCredentialInfo, ClaudeUsageResponse } from "./types.js";
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

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase();
}

function readProfiles(): ClaudeProfilesFile {
  ensureStoreDir();
  try {
    return JSON.parse(readFileSync(PROFILES_PATH, "utf-8")) as ClaudeProfilesFile;
  } catch {
    return { profiles: {} };
  }
}

function writeProfiles(data: ClaudeProfilesFile): void {
  ensureStoreDir();
  writeFileSync(PROFILES_PATH, JSON.stringify(data, null, 2), { mode: 0o600 });
}

interface ClaudeUsageCacheEntry {
  fetchedAt?: string;
  usage?: ClaudeUsageResponse;
  retryAfterAt?: string;
}

function safeFilename(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function usageCachePath(profileName: string): string {
  return join(USAGE_CACHE_DIR, `${safeFilename(profileName)}.json`);
}

export function readClaudeUsageCache(profileName: string): ClaudeUsageCacheEntry | null {
  try {
    return JSON.parse(readFileSync(usageCachePath(profileName), "utf-8")) as ClaudeUsageCacheEntry;
  } catch {
    return null;
  }
}

export function writeClaudeUsageCache(profileName: string, entry: ClaudeUsageCacheEntry): void {
  ensureStoreDir();
  mkdirSync(USAGE_CACHE_DIR, { recursive: true, mode: 0o700 });
  const path = usageCachePath(profileName);
  const temp = `${path}.tmp-${process.pid}`;
  writeFileSync(temp, JSON.stringify(entry, null, 2), { mode: 0o600 });
  renameSync(temp, path);
}

export function validateProfileName(name: string): string | null {
  if (!name) return "Profile name is required.";
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
export function getInstancePath(name: string): string {
  const data = readProfiles();
  const profile = data.profiles[name];
  const dir = profile?.dir || sanitizeName(name);
  return join(INSTANCES_DIR, dir);
}

/** Initialize an instance directory with Claude-expected subdirectories + MCP sync */
function initInstanceDir(instancePath: string): string {
  ensureStoreDir();
  mkdirSync(instancePath, { recursive: true, mode: 0o700 });
  for (const dir of ["session-env", "todos", "logs", "file-history", "shell-snapshots", "debug", ".anthropic"]) {
    const p = join(instancePath, dir);
    if (!existsSync(p)) mkdirSync(p, { recursive: true, mode: 0o700 });
  }
  syncMcpServers(instancePath);
  return instancePath;
}

/** Create a named profile with its own instance directory */
export function createProfile(name: string): string {
  const dir = sanitizeName(name);
  const instancePath = initInstanceDir(join(INSTANCES_DIR, dir));

  const data = readProfiles();
  data.profiles[name] = { name, createdAt: new Date().toISOString(), dir };
  if (!data.active) data.active = name;
  writeProfiles(data);

  return instancePath;
}

/** Create a temporary instance dir for login before we know the email.
 *  Returns { path, dirName } — the dirName is stable and never renamed. */
export function createTempInstance(): { path: string; dirName: string } {
  const dirName = `_p${Date.now()}`;
  const instancePath = join(INSTANCES_DIR, dirName);
  initInstanceDir(instancePath);
  return { path: instancePath, dirName };
}

/** Register a profile pointing to an existing instance directory (no rename). */
export function registerProfile(name: string, dirName: string): void {
  const data = readProfiles();
  if (data.profiles[name]) {
    data.profiles[name]!.lastUsed = new Date().toISOString();
    data.profiles[name]!.dir = dirName;
  } else {
    data.profiles[name] = { name, createdAt: new Date().toISOString(), dir: dirName };
  }
  if (!data.active) data.active = name;
  writeProfiles(data);
}

/** Clean up an instance directory by dir name */
export function cleanupInstance(dirName: string): void {
  const p = join(INSTANCES_DIR, dirName);
  if (existsSync(p)) rmSync(p, { recursive: true, force: true });
}

export function listProfiles(): ClaudeProfile[] {
  return Object.values(readProfiles().profiles).sort((a, b) => a.name.localeCompare(b.name));
}

export function findProfile(name: string): ClaudeProfile | null {
  return readProfiles().profiles[name] || null;
}

export function removeProfile(name: string): boolean {
  const data = readProfiles();
  const profile = data.profiles[name];
  if (!profile) return false;

  const dir = profile.dir || sanitizeName(name);
  delete data.profiles[name];
  if (data.active === name) {
    const remaining = Object.keys(data.profiles);
    data.active = remaining[0];
  }
  writeProfiles(data);

  const instancePath = join(INSTANCES_DIR, dir);
  if (existsSync(instancePath)) rmSync(instancePath, { recursive: true, force: true });
  return true;
}

export function getActiveProfile(): string | null {
  return readProfiles().active || null;
}

export function setActiveProfile(name: string): void {
  const data = readProfiles();
  if (!data.profiles[name]) throw new Error(`Profile "${name}" not found`);
  data.active = name;
  data.profiles[name]!.lastUsed = new Date().toISOString();
  writeProfiles(data);
}

export function detectClaudeCli(): string | null {
  try {
    const result = execSync("which claude", {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    }).trim();
    return result || null;
  } catch {
    return null;
  }
}

/** Get auth status by running `claude auth status` with a given CLAUDE_CONFIG_DIR */
export function getAuthStatusForPath(instancePath: string): Promise<ClaudeAuthStatus | null> {
  const claudePath = detectClaudeCli();
  if (!claudePath) return Promise.resolve(null);
  if (!existsSync(instancePath)) return Promise.resolve(null);

  return new Promise((resolve) => {
    execFile(claudePath, ["auth", "status"], {
      encoding: "utf-8",
      timeout: 10000,
      env: { ...process.env, CLAUDE_CONFIG_DIR: instancePath },
    }, (_error, stdout) => {
      const output = (stdout || "").trim();
      if (!output) { resolve(null); return; }
      try {
        const parsed = JSON.parse(output) as Partial<ClaudeAuthStatus>;
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
      } catch { /* ignore parse errors */ }
      resolve(null);
    });
  });
}

/** Get auth status for a named profile */
export function getAuthStatusAsync(name: string): Promise<ClaudeAuthStatus | null> {
  return getAuthStatusForPath(getInstancePath(name));
}

/** Compute the Keychain service suffix for a CLAUDE_CONFIG_DIR path */
function keychainHash(instancePath: string): string {
  return createHash("sha256").update(instancePath).digest("hex").slice(0, 8);
}

/** Read Claude credential from macOS Keychain or .credentials.json fallback */
export function readCredential(instancePath: string): Promise<ClaudeCredentialInfo | null> {
  // Try .credentials.json first (Linux/Windows, or if it exists on macOS)
  const credPath = join(instancePath, ".credentials.json");
  if (existsSync(credPath)) {
    try {
      const raw = JSON.parse(readFileSync(credPath, "utf-8"));
      const oauth = raw?.claudeAiOauth;
      if (oauth) {
        return Promise.resolve({
          accessToken: oauth.accessToken,
          refreshToken: oauth.refreshToken,
          subscriptionType: oauth.subscriptionType,
          rateLimitTier: oauth.rateLimitTier,
          expiresAt: oauth.expiresAt,
          refreshTokenExpiresAt: oauth.refreshTokenExpiresAt,
          scopes: Array.isArray(oauth.scopes) ? oauth.scopes : undefined,
          clientId: oauth.clientId,
        });
      }
    } catch { /* fall through */ }
  }

  // macOS: read from Keychain
  if (process.platform !== "darwin") return Promise.resolve(null);

  const hash = keychainHash(instancePath);
  const service = `Claude Code-credentials-${hash}`;
  const account = userInfo().username;

  return new Promise((resolve) => {
    execFile("security", ["find-generic-password", "-s", service, "-a", account, "-w"], {
      encoding: "utf-8",
      timeout: 5000,
    }, (_error, stdout) => {
      if (!stdout?.trim()) { resolve(null); return; }
      try {
        const data = JSON.parse(stdout.trim());
        const oauth = data?.claudeAiOauth;
        if (oauth) {
          resolve({
            accessToken: oauth.accessToken,
            refreshToken: oauth.refreshToken,
            subscriptionType: oauth.subscriptionType,
            rateLimitTier: oauth.rateLimitTier,
            expiresAt: oauth.expiresAt,
            refreshTokenExpiresAt: oauth.refreshTokenExpiresAt,
            scopes: Array.isArray(oauth.scopes) ? oauth.scopes : undefined,
            clientId: oauth.clientId,
          });
          return;
        }
      } catch { /* ignore */ }
      resolve(null);
    });
  });
}

async function readCredentialPayload(instancePath: string): Promise<Record<string, unknown>> {
  const credPath = join(instancePath, ".credentials.json");
  if (existsSync(credPath)) {
    return JSON.parse(readFileSync(credPath, "utf-8")) as Record<string, unknown>;
  }
  if (process.platform !== "darwin") return {};

  const service = `Claude Code-credentials-${keychainHash(instancePath)}`;
  const account = userInfo().username;
  return new Promise((resolve, reject) => {
    execFile("security", ["find-generic-password", "-s", service, "-a", account, "-w"], {
      encoding: "utf-8",
      timeout: 5000,
    }, (error, stdout) => {
      if (error || !stdout?.trim()) { reject(error ?? new Error("Claude credential not found")); return; }
      try { resolve(JSON.parse(stdout.trim()) as Record<string, unknown>); }
      catch (parseError) { reject(parseError); }
    });
  });
}

async function writeCredentialPayload(instancePath: string, payload: Record<string, unknown>): Promise<void> {
  const serialized = JSON.stringify(payload, null, 2);
  const credPath = join(instancePath, ".credentials.json");
  if (existsSync(credPath) || process.platform !== "darwin") {
    const temp = `${credPath}.tmp-${process.pid}`;
    writeFileSync(temp, serialized, { mode: 0o600 });
    renameSync(temp, credPath);
    return;
  }

  const service = `Claude Code-credentials-${keychainHash(instancePath)}`;
  const account = userInfo().username;
  await new Promise<void>((resolve, reject) => {
    execFile("security", ["add-generic-password", "-U", "-s", service, "-a", account, "-w", serialized], {
      encoding: "utf-8",
      timeout: 5000,
    }, (error) => error ? reject(error) : resolve());
  });
}

interface ClaudeTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_token_expires_in?: number;
  scope?: string;
}

/** Refresh an expiring Claude OAuth credential and persist any rotated tokens. */
export async function ensureFreshClaudeCredential(
  instancePath: string,
  credential: ClaudeCredentialInfo,
  fetchImpl: typeof fetch = fetch,
): Promise<ClaudeCredentialInfo> {
  if (credential.expiresAt && credential.expiresAt > Date.now() + REFRESH_EARLY_MS) return credential;

  // A concurrent Claude process may already have refreshed the file.
  const latest = await readCredential(instancePath);
  if (latest?.expiresAt && latest.expiresAt > Date.now() + REFRESH_EARLY_MS) return latest;
  const current = latest ?? credential;
  if (!current.refreshToken) throw new Error("Claude OAuth token expired and no refresh token is available; run 'aa claude run' and /login");
  if (current.refreshTokenExpiresAt && current.refreshTokenExpiresAt <= Date.now()) {
    throw new Error("Claude OAuth refresh token expired; run 'aa claude run' and /login");
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
    if (concurrent?.expiresAt && concurrent.expiresAt > Date.now() + REFRESH_EARLY_MS) return concurrent;
    throw new Error(`Claude OAuth refresh failed (${res.status} ${res.statusText})`);
  }

  const token = await res.json() as ClaudeTokenResponse;
  if (!token.access_token || typeof token.expires_in !== "number") {
    throw new Error("Claude OAuth refresh returned an incomplete token response");
  }
  const refreshed: ClaudeCredentialInfo = {
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
    ? payload.claudeAiOauth as Record<string, unknown>
    : {};
  payload.claudeAiOauth = { ...existingOauth, ...refreshed };
  await writeCredentialPayload(instancePath, payload);
  return refreshed;
}

export class ClaudeUsageError extends Error {
  constructor(message: string, public status?: number, public retryAfterSeconds?: number) {
    super(message);
    this.name = "ClaudeUsageError";
  }
}

/** Fetch rate limit utilization from /api/oauth/usage */
export async function fetchClaudeUsage(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ClaudeUsageResponse> {
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
      throw new ClaudeUsageError(
        `Claude usage request failed (${res.status} ${res.statusText})`,
        res.status,
        Number.isFinite(retryAfter) ? retryAfter : undefined,
      );
    }
    const body = await res.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new ClaudeUsageError("Claude usage request returned an invalid response");
    }
    return body as ClaudeUsageResponse;
  } catch (error) {
    if (error instanceof ClaudeUsageError) throw error;
    throw new ClaudeUsageError(`Claude usage request failed: ${(error as Error).message}`);
  }
}

/** Copy MCP server config from global ~/.claude.json into the instance */
function syncMcpServers(instancePath: string): void {
  const globalClaudeJson = join(homedir(), ".claude.json");
  if (!existsSync(globalClaudeJson)) return;

  try {
    const global = JSON.parse(readFileSync(globalClaudeJson, "utf-8"));
    const mcp = global.mcpServers;
    if (!mcp || typeof mcp !== "object" || Array.isArray(mcp) || Object.keys(mcp).length === 0) return;

    const instanceJson = join(instancePath, ".claude.json");
    let content: Record<string, unknown> = {};
    if (existsSync(instanceJson)) {
      try { content = JSON.parse(readFileSync(instanceJson, "utf-8")); } catch { content = {}; }
    }

    const existing = content.mcpServers && typeof content.mcpServers === "object" && !Array.isArray(content.mcpServers)
      ? content.mcpServers as Record<string, unknown> : {};
    content.mcpServers = { ...mcp, ...existing };
    writeFileSync(instanceJson, JSON.stringify(content, null, 2), { mode: 0o600 });
  } catch {
    // Best-effort
  }
}
