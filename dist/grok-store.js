import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, } from "node:fs";
import { execFile, execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { ensureStoreDir, STORE_DIR } from "./paths.js";
const PROFILES_PATH = join(STORE_DIR, "grok.json");
const INSTANCES_DIR = join(STORE_DIR, "grok");
const BILLING_URL = "https://cli-chat-proxy.grok.com/v1/billing?format=credits";
const USER_URL = "https://cli-chat-proxy.grok.com/v1/user?include=subscription";
const RESERVED_NAMES = new Set([
    "add", "login", "list", "ls", "switch", "use", "remove", "rm",
    "env", "status", "run", "help",
]);
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
    const temp = `${PROFILES_PATH}.tmp`;
    writeFileSync(temp, JSON.stringify(data, null, 2), { mode: 0o600 });
    renameSync(temp, PROFILES_PATH);
}
export function validateGrokProfileName(name) {
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
export function getGrokInstancePath(name) {
    const profile = readProfiles().profiles[name];
    return join(INSTANCES_DIR, profile?.dir || sanitizeName(name));
}
function copyGlobalSettings(instancePath) {
    const globalHome = join(homedir(), ".grok");
    if (!existsSync(globalHome) || globalHome === instancePath)
        return;
    for (const file of ["config.toml", "managed_config.toml", "requirements.toml"]) {
        const source = join(globalHome, file);
        const target = join(instancePath, file);
        if (existsSync(source) && !existsSync(target))
            cpSync(source, target);
    }
    for (const dir of ["skills", "plugins", "hooks"]) {
        const source = join(globalHome, dir);
        const target = join(instancePath, dir);
        if (existsSync(source) && !existsSync(target))
            cpSync(source, target, { recursive: true });
    }
}
function initInstanceDir(path) {
    ensureStoreDir();
    mkdirSync(path, { recursive: true, mode: 0o700 });
    copyGlobalSettings(path);
    return path;
}
export function createGrokProfile(name) {
    const dir = sanitizeName(name);
    const instancePath = initInstanceDir(join(INSTANCES_DIR, dir));
    const data = readProfiles();
    data.profiles[name] = { name, createdAt: new Date().toISOString(), dir };
    if (!data.active)
        data.active = name;
    writeProfiles(data);
    return instancePath;
}
export function createTempGrokInstance() {
    const dirName = `_p${Date.now()}`;
    return { path: initInstanceDir(join(INSTANCES_DIR, dirName)), dirName };
}
export function registerGrokProfile(name, dirName) {
    const data = readProfiles();
    data.profiles[name] = data.profiles[name] ?? {
        name,
        createdAt: new Date().toISOString(),
        dir: dirName,
    };
    data.profiles[name].dir = dirName;
    if (!data.active)
        data.active = name;
    writeProfiles(data);
}
export function cleanupGrokInstance(dirName) {
    const path = join(INSTANCES_DIR, dirName);
    if (existsSync(path))
        rmSync(path, { recursive: true, force: true });
}
export function listGrokProfiles() {
    return Object.values(readProfiles().profiles).sort((a, b) => a.name.localeCompare(b.name));
}
export function findGrokProfile(name) {
    return readProfiles().profiles[name] ?? null;
}
export function removeGrokProfile(name) {
    const data = readProfiles();
    const profile = data.profiles[name];
    if (!profile)
        return false;
    delete data.profiles[name];
    if (data.active === name)
        data.active = Object.keys(data.profiles)[0];
    writeProfiles(data);
    cleanupGrokInstance(profile.dir || sanitizeName(name));
    return true;
}
export function getActiveGrokProfile() {
    return readProfiles().active ?? null;
}
export function setActiveGrokProfile(name) {
    const data = readProfiles();
    if (!data.profiles[name])
        throw new Error(`Profile "${name}" not found.`);
    data.active = name;
    data.profiles[name].lastUsed = new Date().toISOString();
    writeProfiles(data);
}
export function detectGrokCli() {
    try {
        const path = execFileSync(process.platform === "win32" ? "where" : "which", ["grok"], {
            encoding: "utf-8",
            stdio: ["ignore", "pipe", "ignore"],
            timeout: 5000,
        }).trim().split(/\r?\n/)[0];
        return path || null;
    }
    catch {
        return null;
    }
}
export function parseGrokAuthFile(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return null;
    const entries = Object.entries(value);
    const preferred = entries.find(([scope]) => scope.startsWith("https://auth.x.ai::"));
    const candidates = preferred ? [preferred, ...entries.filter(e => e !== preferred)] : entries;
    for (const [, auth] of candidates) {
        if (auth && typeof auth.key === "string" && typeof auth.user_id === "string")
            return auth;
    }
    return null;
}
export function readGrokAuth(instancePath) {
    try {
        return parseGrokAuthFile(JSON.parse(readFileSync(join(instancePath, "auth.json"), "utf-8")));
    }
    catch {
        return null;
    }
}
let versionPromise;
function getGrokVersion() {
    if (versionPromise)
        return versionPromise;
    versionPromise = new Promise((resolve) => {
        const cli = detectGrokCli();
        if (!cli)
            return resolve("1.0.0");
        execFile(cli, ["--version"], { encoding: "utf-8", timeout: 5000 }, (_err, stdout) => {
            resolve((stdout || "").match(/\d+\.\d+\.\d+(?:[-+][\w.-]+)?/)?.[0] ?? "1.0.0");
        });
    });
    return versionPromise;
}
export class GrokHttpError extends Error {
    status;
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}
/** Fetch the account-wide credit pool used by Grok Build's own /usage view. */
export async function fetchGrokUsage(auth, fetcher = fetch, clientVersion) {
    if (auth.auth_mode === "api_key") {
        throw new Error("Grok Build subscription usage is unavailable for API-key profiles.");
    }
    const version = clientVersion ?? await getGrokVersion();
    const headers = {
        Authorization: `Bearer ${auth.key}`,
        "X-XAI-Token-Auth": "xai-grok-cli",
        "x-userid": auth.user_id,
        "x-grok-client-version": version,
        "x-grok-client-mode": "interactive",
    };
    const [billingResponse, userResponse] = await Promise.all([
        fetcher(BILLING_URL, { headers, signal: AbortSignal.timeout(15000) }),
        fetcher(USER_URL, { headers, signal: AbortSignal.timeout(10000) }),
    ]);
    if (!billingResponse.ok) {
        const body = await billingResponse.text();
        let detail = body;
        try {
            const parsed = JSON.parse(body);
            detail = parsed.error || body;
        }
        catch { /* use raw response */ }
        throw new GrokHttpError(billingResponse.status, `Grok usage fetch failed (${billingResponse.status})${detail ? `: ${detail}` : ""}`);
    }
    const billing = await billingResponse.json();
    if (userResponse.ok) {
        const user = await userResponse.json();
        billing.subscriptionTier = user.subscriptionTier ?? billing.subscriptionTier;
    }
    return billing;
}
function runGrokRefresh(instancePath) {
    const cli = detectGrokCli();
    if (!cli)
        return Promise.resolve();
    return new Promise((resolve) => {
        execFile(cli, ["models"], {
            encoding: "utf-8",
            timeout: 30000,
            env: { ...process.env, GROK_HOME: instancePath },
        }, () => resolve());
    });
}
/** Retry once after asking Grok itself to refresh its isolated OAuth session. */
export async function fetchGrokUsageForPath(instancePath) {
    let auth = readGrokAuth(instancePath);
    if (!auth)
        throw new Error("Not logged in. Run 'aa grok add' to authenticate this profile.");
    try {
        return { auth, usage: await fetchGrokUsage(auth) };
    }
    catch (error) {
        if (!(error instanceof GrokHttpError) || error.status !== 401)
            throw error;
        await runGrokRefresh(instancePath);
        auth = readGrokAuth(instancePath);
        if (!auth)
            throw error;
        return { auth, usage: await fetchGrokUsage(auth) };
    }
}
//# sourceMappingURL=grok-store.js.map