import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { homedir, userInfo } from "node:os";
import { execFile, execSync } from "node:child_process";
import { ensureStoreDir, STORE_DIR } from "./paths.js";
const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const OAUTH_BETA_HEADER = "oauth-2025-04-20";
const PROFILES_PATH = join(STORE_DIR, "claude.json");
const INSTANCES_DIR = join(STORE_DIR, "claude");
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
/** Read Claude credential from macOS Keychain or .credentials.json fallback */
export function readCredential(instancePath) {
    // Try .credentials.json first (Linux/Windows, or if it exists on macOS)
    const credPath = join(instancePath, ".credentials.json");
    if (existsSync(credPath)) {
        try {
            const raw = JSON.parse(readFileSync(credPath, "utf-8"));
            const oauth = raw?.claudeAiOauth;
            if (oauth) {
                return Promise.resolve({
                    accessToken: oauth.accessToken,
                    subscriptionType: oauth.subscriptionType,
                    rateLimitTier: oauth.rateLimitTier,
                    expiresAt: oauth.expiresAt,
                });
            }
        }
        catch { /* fall through */ }
    }
    // macOS: read from Keychain
    if (process.platform !== "darwin")
        return Promise.resolve(null);
    const hash = keychainHash(instancePath);
    const service = `Claude Code-credentials-${hash}`;
    const account = userInfo().username;
    return new Promise((resolve) => {
        execFile("security", ["find-generic-password", "-s", service, "-a", account, "-w"], {
            encoding: "utf-8",
            timeout: 5000,
        }, (_error, stdout) => {
            if (!stdout?.trim()) {
                resolve(null);
                return;
            }
            try {
                const data = JSON.parse(stdout.trim());
                const oauth = data?.claudeAiOauth;
                if (oauth) {
                    resolve({
                        accessToken: oauth.accessToken,
                        subscriptionType: oauth.subscriptionType,
                        rateLimitTier: oauth.rateLimitTier,
                        expiresAt: oauth.expiresAt,
                    });
                    return;
                }
            }
            catch { /* ignore */ }
            resolve(null);
        });
    });
}
/** Fetch rate limit utilization from /api/oauth/usage */
export async function fetchClaudeUsage(accessToken) {
    try {
        const res = await fetch(USAGE_URL, {
            headers: {
                "Authorization": `Bearer ${accessToken}`,
                "anthropic-beta": OAUTH_BETA_HEADER,
                "Content-Type": "application/json",
            },
            signal: AbortSignal.timeout(10000),
        });
        if (!res.ok)
            return null;
        return (await res.json());
    }
    catch {
        return null;
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