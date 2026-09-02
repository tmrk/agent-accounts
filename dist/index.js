#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdirSync, openSync, appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readActiveAuth, writeActiveAuth, readAuthFromHome, listAccounts, saveAccount, findAccount, removeAccount, detectActiveAccount, syncActiveToStore, listAdminKeys, findAdminKey, saveAdminKey, removeAdminKey, pickAdminKeyFor, readUsageCache, readUsageCacheStale, writeUsageCache } from "./store.js";
import { extractEmail } from "./jwt.js";
import { refreshIfExpired } from "./token-refresh.js";
import { loadAccountUsage } from "./usage.js";
import { displayAllUsage, displayAllUsageNumbered, displayAccountList } from "./display.js";
import { claudeMain, claudeStatus } from "./claude.js";
import { grokMain, grokStatus } from "./grok.js";
import { validateAdminKey, listProjects, fetchUsageRollup } from "./openai-admin.js";
import { rankUsagesForGto } from "./gto.js";
import { restartCodexGui } from "./codex-gui.js";
import { parseSwitchArgs } from "./switch-options.js";
import { parseAddArgs } from "./add-options.js";
import { runCodexLogin } from "./codex-login.js";
import { questionOrEscape } from "./interactive.js";
import { parseLiveArgs, runLive } from "./live.js";
const USAGE_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const HELP = `agent-accounts (aa) - Manage Codex, Claude Code, and Grok Build accounts

Usage:
  aa                         Show usage across all providers
  aa status                  Show usage across all providers
  aa status --live           Refresh usage in place every 30 seconds
  aa status --live --interval 10
  aa codex [command]         Manage Codex accounts
  aa claude [command]        Manage Claude Code accounts
  aa grok [command]          Manage Grok Build accounts

Codex commands:
  aa codex                   Show Codex usage and switch
  aa codex add [--device-auth]
  aa codex add-key           Add an API-key account
  aa codex import            Import ~/.codex/auth.json
  aa codex list
  aa codex switch [email]
  aa codex gui-switch [email]
  aa codex remove <email>
  aa codex usage [days]      Show API spend (default 30 days)

Provider help:
  aa claude help
  aa grok help

The original flat Codex commands (for example, \`aa add\`) remain aliases.
`;
async function cmdAdd(options = { deviceAuth: false }) {
    // Save current active auth before we switch the live Codex home.
    syncActiveToStore();
    const loginHome = mkdtempSync(join(tmpdir(), "aa-codex-login-"));
    console.log(options.deviceAuth
        ? "Opening Codex device-code login in an isolated home...\n"
        : "Opening Codex OAuth login in an isolated home...\n");
    console.log("This does not sign out other stored accounts.\n");
    try {
        await runCodexLogin(options, undefined, {
            env: { ...process.env, CODEX_HOME: loginHome },
        });
        const auth = readAuthFromHome(loginHome);
        if (!auth?.tokens?.id_token) {
            console.error("Error: No auth found after login. Make sure codex login completed successfully.");
            process.exit(1);
        }
        const email = extractEmail(auth.tokens.id_token);
        if (!email) {
            console.error("Error: Could not extract email from auth token.");
            process.exit(1);
        }
        const existing = findAccount(email);
        if (existing) {
            existing.auth = auth;
            saveAccount(existing);
            console.log(`\nUpdated account: ${email}`);
        }
        else {
            const account = {
                email,
                addedAt: new Date().toISOString(),
                auth,
            };
            saveAccount(account);
            console.log(`\nAdded account: ${email}`);
        }
        writeActiveAuth(auth);
    }
    finally {
        rmSync(loginHome, { recursive: true, force: true });
    }
}
async function cmdAddKey() {
    syncActiveToStore();
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const label = await new Promise((resolve) => {
        rl.question("Label (e.g. work, personal): ", resolve);
    });
    const key = await new Promise((resolve) => {
        rl.question("API key (sk-...): ", resolve);
    });
    rl.close();
    const trimmedLabel = label.trim();
    const trimmedKey = key.trim();
    if (!trimmedLabel) {
        console.error("Label is required.");
        process.exit(1);
    }
    if (!trimmedKey.startsWith("sk-")) {
        console.error("Invalid API key format (expected sk-...).");
        process.exit(1);
    }
    const auth = {
        auth_mode: "apikey",
        OPENAI_API_KEY: trimmedKey,
    };
    // Use label as the identifier (prefixed to distinguish from emails)
    const identifier = `apikey:${trimmedLabel}`;
    const existing = findAccount(identifier);
    if (existing) {
        existing.auth = auth;
        saveAccount(existing);
        console.log(`Updated API key account: ${trimmedLabel}`);
    }
    else {
        const account = {
            email: identifier,
            addedAt: new Date().toISOString(),
            auth,
        };
        saveAccount(account);
        console.log(`Added API key account: ${trimmedLabel}`);
    }
}
// --- Admin key commands ---
async function cmdAddAdminKey() {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const label = await new Promise(resolve => {
        rl.question("Label (e.g. manaflow): ", resolve);
    });
    const key = await new Promise(resolve => {
        rl.question("Admin key (sk-admin-...): ", resolve);
    });
    rl.close();
    const trimmedLabel = label.trim();
    const trimmedKey = key.trim();
    if (!trimmedLabel) {
        console.error("Label is required.");
        process.exit(1);
    }
    if (!trimmedKey.startsWith("sk-admin-")) {
        console.error("Invalid admin key format (expected sk-admin-...).");
        process.exit(1);
    }
    process.stdout.write("Validating with OpenAI... ");
    const validation = await validateAdminKey(trimmedKey);
    if (!validation.ok) {
        console.log("\x1b[31mfailed\x1b[0m");
        console.error(validation.error);
        process.exit(1);
    }
    console.log("\x1b[32mok\x1b[0m");
    const entry = {
        label: trimmedLabel,
        key: trimmedKey,
        orgId: validation.orgId,
        addedAt: new Date().toISOString(),
    };
    saveAdminKey(entry);
    console.log(`Added admin key: ${trimmedLabel}`);
    console.log(`Run 'aa usage' to fetch spend, or 'aa attach-project <api-key>' to scope it per project.`);
}
async function cmdListAdminKeys() {
    const all = listAdminKeys();
    if (all.length === 0) {
        console.log("No admin keys. Run 'aa add-admin-key' to add one.");
        return;
    }
    console.log();
    for (const k of all) {
        const date = new Date(k.addedAt).toLocaleDateString();
        const masked = k.key.slice(0, 12) + "***" + k.key.slice(-6);
        console.log(`  ${k.label}  \x1b[2m${masked}  added ${date}\x1b[0m`);
    }
    console.log();
}
async function cmdRemoveAdminKey(label) {
    if (!findAdminKey(label)) {
        console.error(`No admin key labeled "${label}".`);
        process.exit(1);
    }
    removeAdminKey(label);
    console.log(`Removed admin key: ${label}`);
}
async function cmdAttachProject(apiKeyLabel, opts) {
    const identifier = apiKeyLabel.startsWith("apikey:") ? apiKeyLabel : `apikey:${apiKeyLabel}`;
    const account = findAccount(identifier);
    if (!account) {
        console.error(`No API-key account named "${apiKeyLabel}". Use 'aa list' to see all.`);
        process.exit(1);
    }
    if (account.auth.auth_mode !== "apikey") {
        console.error(`"${apiKeyLabel}" is not an API-key account.`);
        process.exit(1);
    }
    const admin = pickAdminKeyFor(account);
    if (!admin) {
        console.error("No admin key configured. Run 'aa add-admin-key' first.");
        process.exit(1);
    }
    process.stdout.write("Listing OpenAI projects... ");
    const projects = await listProjects(admin.key);
    console.log(`(${projects.length})`);
    if (projects.length === 0) {
        console.error("No projects returned. Make sure the admin key has 'api.management.read' scope.");
        process.exit(1);
    }
    let chosenIdx;
    if (opts?.projectId) {
        if (opts.projectId === "none" || opts.projectId === "org") {
            chosenIdx = 0;
        }
        else {
            const found = projects.findIndex(p => p.id === opts.projectId || p.name === opts.projectId);
            if (found === -1) {
                console.error(`No project matching id/name "${opts.projectId}". Available:`);
                for (const p of projects)
                    console.error(`  ${p.id}  ${p.name}`);
                process.exit(1);
            }
            chosenIdx = found + 1;
        }
    }
    else {
        console.log();
        for (let i = 0; i < projects.length; i++) {
            console.log(`  ${i + 1}) ${projects[i].name}  \x1b[2m${projects[i].id}\x1b[0m`);
        }
        console.log(`  0) <none / org-wide>`);
        console.log();
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        const ans = await new Promise(resolve => rl.question("Pick project (#): ", resolve));
        rl.close();
        chosenIdx = parseInt(ans.trim(), 10);
        if (isNaN(chosenIdx) || chosenIdx < 0 || chosenIdx > projects.length) {
            console.error("Invalid selection.");
            process.exit(1);
        }
    }
    if (chosenIdx === 0) {
        delete account.projectId;
        delete account.projectName;
    }
    else {
        const proj = projects[chosenIdx - 1];
        account.projectId = proj.id;
        account.projectName = proj.name;
    }
    account.adminKeyLabel = admin.label;
    saveAccount(account);
    console.log(`Updated ${apiKeyLabel}: project=${account.projectName ?? "<org-wide>"} via admin=${admin.label}`);
}
// --- Usage fetching ---
function summarizeDaily(daily) {
    const tok = (d) => d.inputTokens + d.cachedInputTokens + d.outputTokens;
    const cost = (d) => Number(d.costUsd) || 0;
    const todayIso = new Date().toISOString().slice(0, 10);
    const todayRow = daily.find(d => d.date === todayIso);
    const last7 = daily.slice(-7);
    const last30 = daily.slice(-30);
    return {
        todayUsd: todayRow ? cost(todayRow) : 0,
        todayCostEstimated: todayRow?.costEstimated ?? false,
        todayTokens: todayRow ? tok(todayRow) : 0,
        weekUsd: last7.reduce((s, d) => s + cost(d), 0),
        weekTokens: last7.reduce((s, d) => s + tok(d), 0),
        monthUsd: last30.reduce((s, d) => s + cost(d), 0),
        monthTokens: last30.reduce((s, d) => s + tok(d), 0),
    };
}
async function fetchSnapshotForAccount(account, admin, days = 30) {
    // Single call: fetchUsageRollup runs all 3 OpenAI requests (daily costs,
    // daily usage, today hourly) concurrently and computes top model from the
    // already-grouped responses, no extra request.
    const { daily, topModel } = await fetchUsageRollup(admin.key, days, account.projectId);
    const sums = summarizeDaily(daily);
    const snapshot = {
        adminKeyLabel: admin.label,
        orgId: admin.orgId,
        projectId: account.projectId,
        projectName: account.projectName,
        fetchedAt: new Date().toISOString(),
        ...sums,
        topModel,
        daily,
    };
    writeUsageCache(snapshot);
    return snapshot;
}
async function cmdUsage(daysArg) {
    const days = daysArg ? parseInt(daysArg, 10) : 30;
    if (isNaN(days) || days < 1 || days > 30) {
        console.error("days must be 1..30");
        process.exit(1);
    }
    const accounts = listAccounts().filter(a => a.auth.auth_mode === "apikey");
    if (accounts.length === 0) {
        console.log("No API-key accounts. Run 'aa add-key' first.");
        return;
    }
    const admins = listAdminKeys();
    if (admins.length === 0) {
        console.error("No admin keys. Run 'aa add-admin-key' first.");
        process.exit(1);
    }
    console.log(`Fetching ${days}-day usage for ${accounts.length} API-key account(s) in parallel...`);
    console.log("\x1b[2m(/v1/organization/* endpoints are slow; ~30-60s wall-time per account)\x1b[0m");
    console.log();
    const activeEmail = detectActiveAccount();
    const wallStart = Date.now();
    const usages = await Promise.all(accounts.map(async (account) => {
        const admin = pickAdminKeyFor(account);
        if (!admin) {
            console.log(`  ${account.email.replace(/^apikey:/, "")}: \x1b[33mno admin key\x1b[0m`);
            return {
                email: account.email,
                isActive: account.email === activeEmail,
                planType: "api key",
                apiKeyHint: "no admin key linked - run 'aa add-admin-key'",
            };
        }
        const t0 = Date.now();
        try {
            const snapshot = await fetchSnapshotForAccount(account, admin, days);
            console.log(`  ${account.email.replace(/^apikey:/, "")} via ${admin.label}: \x1b[32mok\x1b[0m \x1b[2m(${Math.round((Date.now() - t0) / 1000)}s)\x1b[0m`);
            return {
                email: account.email,
                isActive: account.email === activeEmail,
                planType: "api key",
                apiKeySpend: snapshot,
            };
        }
        catch (err) {
            console.log(`  ${account.email.replace(/^apikey:/, "")} via ${admin.label}: \x1b[31mfailed\x1b[0m \x1b[2m(${Math.round((Date.now() - t0) / 1000)}s)\x1b[0m`);
            return {
                email: account.email,
                isActive: account.email === activeEmail,
                planType: "api key",
                error: err.message,
            };
        }
    }));
    console.log(`\n\x1b[2mwall: ${Math.round((Date.now() - wallStart) / 1000)}s\x1b[0m\n`);
    displayAllUsage(usages);
}
/** Soft TTL: data older than this triggers a background refresh on default view. */
const USAGE_REFRESH_AFTER_MS = 5 * 60 * 1000; // 5 min
let lastBackgroundRefreshSpawnAt = 0;
/**
 * If any API-key account has stale (or no) cache and an admin key exists,
 * spawn a detached child to refresh in the background. The parent does not
 * wait. Next `aa` invocation reads the updated cache.
 */
function maybeSpawnBackgroundRefresh() {
    if (Date.now() - lastBackgroundRefreshSpawnAt < USAGE_REFRESH_AFTER_MS)
        return;
    const accounts = listAccounts().filter(a => a.auth.auth_mode === "apikey");
    if (accounts.length === 0)
        return;
    const admins = listAdminKeys();
    if (admins.length === 0)
        return;
    const stale = accounts.some(a => {
        const admin = pickAdminKeyFor(a) ?? admins[0];
        const fresh = readUsageCache(admin.label, a.projectId, USAGE_REFRESH_AFTER_MS);
        return fresh == null;
    });
    if (!stale)
        return;
    // Self-spawn the hidden refresh command, fully detached. Log stdio to a
    // rotating file so we can debug if a refresh ever fails.
    const logDir = `${process.env.HOME ?? "/tmp"}/.agent-accounts`;
    const logPath = `${logDir}/usage-refresh.log`;
    let stdio = "ignore";
    try {
        mkdirSync(logDir, { recursive: true });
        const fd = openSync(logPath, "a");
        stdio = ["ignore", fd, fd];
    }
    catch {
        // fall back to ignore
    }
    const child = spawn(process.execPath, [process.argv[1], "__refresh-usage"], {
        detached: true,
        stdio,
        env: { ...process.env, AA_BG_REFRESH: "1" },
    });
    lastBackgroundRefreshSpawnAt = Date.now();
    child.unref();
}
async function cmdRefreshUsageBackground() {
    const logPath = `${process.env.HOME ?? "/tmp"}/.agent-accounts/usage-refresh.log`;
    const log = (msg) => {
        try {
            appendFileSync(logPath, `[${new Date().toISOString()}] ${msg}\n`);
        }
        catch { /* ignore */ }
    };
    log("background refresh started");
    const accounts = listAccounts().filter(a => a.auth.auth_mode === "apikey");
    const wallStart = Date.now();
    await Promise.all(accounts.map(async (account) => {
        const admin = pickAdminKeyFor(account);
        if (!admin) {
            log(`skip ${account.email}: no admin key`);
            return;
        }
        const t0 = Date.now();
        try {
            await fetchSnapshotForAccount(account, admin, 30);
            log(`refreshed ${account.email} via ${admin.label} in ${Math.round((Date.now() - t0) / 1000)}s`);
        }
        catch (err) {
            log(`failed ${account.email} after ${Math.round((Date.now() - t0) / 1000)}s: ${err.message}`);
        }
    }));
    log(`background refresh complete in ${Math.round((Date.now() - wallStart) / 1000)}s`);
}
/** Build an AccountUsage row for an API-key account from cache (no network). */
function apiKeyUsageFromCache(account, isActive, admins) {
    if (admins.length === 0) {
        return {
            email: account.email,
            isActive,
            planType: "api key",
            apiKeyHint: "no admin key - run 'aa add-admin-key' to enable spend display",
        };
    }
    const admin = pickAdminKeyFor(account) ?? admins[0];
    // Try fresh cache first, else stale
    const fresh = readUsageCache(admin.label, account.projectId, USAGE_CACHE_TTL_MS);
    const snapshot = fresh ?? readUsageCacheStale(admin.label, account.projectId);
    if (snapshot) {
        return {
            email: account.email,
            isActive,
            planType: "api key",
            apiKeySpend: snapshot,
        };
    }
    return {
        email: account.email,
        isActive,
        planType: "api key",
        apiKeyHint: `no cached usage - run 'aa usage' (admin: ${admin.label})`,
    };
}
/** Import the currently active account from ~/.codex/auth.json without re-logging in */
async function cmdImport() {
    const auth = readActiveAuth();
    if (!auth?.tokens?.id_token) {
        console.error("No active Codex auth found in ~/.codex/auth.json.");
        console.error("Run 'agent-accounts add' to log in first.");
        process.exit(1);
    }
    const email = extractEmail(auth.tokens.id_token);
    if (!email) {
        console.error("Could not extract email from current auth token.");
        process.exit(1);
    }
    const existing = findAccount(email);
    if (existing) {
        existing.auth = auth;
        saveAccount(existing);
        console.log(`Updated existing account: ${email}`);
    }
    else {
        const account = {
            email,
            addedAt: new Date().toISOString(),
            auth,
        };
        saveAccount(account);
        console.log(`Imported account: ${email}`);
    }
}
/** Auto-import current auth if no accounts stored yet */
function autoImportIfEmpty() {
    const accounts = listAccounts();
    if (accounts.length > 0)
        return;
    const auth = readActiveAuth();
    if (!auth?.tokens?.id_token)
        return;
    const email = extractEmail(auth.tokens.id_token);
    if (!email)
        return;
    const account = {
        email,
        addedAt: new Date().toISOString(),
        auth,
    };
    saveAccount(account);
    console.log(`Auto-imported active account: ${email}\n`);
}
async function cmdList() {
    const accounts = listAccounts();
    const activeEmail = detectActiveAccount();
    displayAccountList(accounts.map(a => ({
        email: a.email,
        isActive: a.email === activeEmail,
        addedAt: a.addedAt,
    })));
}
async function promptSwitch(options = { restartCodexGui: false }) {
    const accounts = listAccounts();
    if (accounts.length === 0) {
        console.error("No accounts configured. Run 'agent-accounts add' to add one.");
        process.exit(1);
    }
    const activeEmail = detectActiveAccount();
    console.log();
    for (let i = 0; i < accounts.length; i++) {
        const a = accounts[i];
        const marker = a.email === activeEmail ? " \x1b[36m(active)\x1b[0m" : "";
        const displayName = a.email.startsWith("apikey:")
            ? `${a.email.slice(7)} \x1b[2m(api key)\x1b[0m`
            : a.email;
        console.log(`  ${i + 1}) ${displayName}${marker}`);
    }
    console.log();
    const answer = await questionOrEscape("Switch to (#, Esc to cancel): ");
    if (answer === undefined)
        return;
    const idx = parseInt(answer.trim(), 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= accounts.length) {
        // Try as email/partial match
        if (answer.trim()) {
            return cmdSwitch(answer.trim(), options);
        }
        console.error("Invalid selection.");
        process.exit(1);
    }
    return cmdSwitch(accounts[idx].email, options);
}
async function cmdSwitch(email, options = { restartCodexGui: false }) {
    const account = findAccount(email);
    if (!account) {
        // Try partial match
        const all = listAccounts();
        const matches = all.filter(a => a.email.toLowerCase().includes(email.toLowerCase()));
        if (matches.length === 0) {
            console.error(`No account found matching "${email}".`);
            console.error("Run 'agent-accounts list' to see all accounts.");
            process.exit(1);
        }
        if (matches.length > 1) {
            console.error(`Multiple accounts match "${email}":`);
            for (const m of matches) {
                console.error(`  ${m.email}`);
            }
            process.exit(1);
        }
        return cmdSwitch(matches[0].email, options);
    }
    // Save current active auth before switching
    syncActiveToStore();
    // Refresh tokens if needed
    try {
        const { auth, refreshed } = await refreshIfExpired(account.auth);
        if (refreshed) {
            account.auth = auth;
            saveAccount(account);
        }
        writeActiveAuth(auth);
    }
    catch (err) {
        // Write anyway even if refresh fails
        writeActiveAuth(account.auth);
        console.warn(`Warning: token refresh failed, using cached tokens: ${err.message}`);
    }
    console.log(`Switched to ${account.email}`);
    if (options.restartCodexGui) {
        await reportCodexGuiRestart();
    }
    else {
        console.log("Restart any running Codex sessions to use the new account.");
    }
}
async function reportCodexGuiRestart() {
    try {
        const result = await restartCodexGui();
        switch (result.status) {
            case "restarted":
                console.log("Restarted Codex.app so the GUI uses the new account.");
                break;
            case "not-running":
                console.log("Codex.app is not running; it will use the new account on next launch.");
                break;
            case "unsupported":
            case "failed":
                console.warn(`Warning: ${result.message}`);
                console.warn("Restart Codex.app manually to use the new account in the GUI.");
                break;
        }
    }
    catch (err) {
        console.warn(`Warning: failed to restart Codex.app: ${err.message}`);
        console.warn("Restart Codex.app manually to use the new account in the GUI.");
    }
}
async function cmdRemove(email) {
    if (!findAccount(email)) {
        // Try partial match
        const all = listAccounts();
        const matches = all.filter(a => a.email.toLowerCase().includes(email.toLowerCase()));
        if (matches.length === 0) {
            console.error(`No account found matching "${email}".`);
            process.exit(1);
        }
        if (matches.length > 1) {
            console.error(`Multiple accounts match "${email}":`);
            for (const m of matches) {
                console.error(`  ${m.email}`);
            }
            process.exit(1);
        }
        email = matches[0].email;
    }
    removeAccount(email);
    console.log(`Removed account: ${email}`);
}
async function cmdStatus() {
    autoImportIfEmpty();
    const accounts = listAccounts();
    if (accounts.length === 0) {
        console.log("No accounts configured. Run 'agent-accounts add' to add one.");
        return;
    }
    const activeEmail = detectActiveAccount();
    // Split into OAuth and API key accounts
    const oauthAccounts = accounts.filter(a => a.auth.auth_mode !== "apikey");
    const apiKeyAccounts = accounts.filter(a => a.auth.auth_mode === "apikey");
    const oauthUsages = await Promise.all(oauthAccounts.map(account => loadAccountUsage(account.email, account.auth, account.email === activeEmail)));
    // API key accounts: pull cached spend if any
    const adminKeys = listAdminKeys();
    const apiKeyUsages = apiKeyAccounts.map(account => apiKeyUsageFromCache(account, account.email === activeEmail, adminKeys));
    const usageByEmail = new Map([...oauthUsages, ...apiKeyUsages].map(u => [u.email, u]));
    const usages = rankUsagesForGto(accounts.map(a => usageByEmail.get(a.email)));
    displayAllUsage(usages);
    maybeSpawnBackgroundRefresh();
}
/** Default interactive mode: show all usage, prompt to switch */
async function cmdDefault(options = { restartCodexGui: false }) {
    autoImportIfEmpty();
    const accounts = listAccounts();
    if (accounts.length === 0) {
        console.log("No accounts configured. Run 'aa add' to add one.");
        return;
    }
    const activeEmail = detectActiveAccount();
    const oauthAccounts = accounts.filter(a => a.auth.auth_mode !== "apikey");
    const apiKeyAccounts = accounts.filter(a => a.auth.auth_mode === "apikey");
    const oauthUsages = await Promise.all(oauthAccounts.map(account => loadAccountUsage(account.email, account.auth, account.email === activeEmail)));
    const adminKeys = listAdminKeys();
    const apiKeyUsages = apiKeyAccounts.map(account => apiKeyUsageFromCache(account, account.email === activeEmail, adminKeys));
    const usageByEmail = new Map([...oauthUsages, ...apiKeyUsages].map(u => [u.email, u]));
    const usages = rankUsagesForGto(accounts.map(a => usageByEmail.get(a.email)));
    displayAllUsageNumbered(usages);
    maybeSpawnBackgroundRefresh();
    // Prompt to switch
    const answer = await questionOrEscape("Switch to (#, Esc to cancel): ");
    if (answer === undefined)
        return;
    const trimmed = answer.trim();
    if (!trimmed)
        return;
    const idx = parseInt(trimmed, 10) - 1;
    if (idx >= 0 && idx < usages.length) {
        return cmdSwitch(usages[idx].email, options);
    }
    // Try as email/partial match
    if (trimmed) {
        return cmdSwitch(trimmed, options);
    }
    console.error("Invalid selection.");
    process.exit(1);
}
async function codexMain(args) {
    const command = args[0];
    if (!command) {
        await cmdDefault();
        return;
    }
    switch (command) {
        case "add":
        case "login": {
            const options = parseAddArgs(args.slice(1));
            await cmdAdd(options);
            break;
        }
        case "add-key":
        case "add-api-key":
            await cmdAddKey();
            break;
        case "import":
            await cmdImport();
            break;
        case "list":
        case "ls":
            await cmdList();
            break;
        case "switch":
        case "use": {
            const parsed = parseSwitchArgs(args.slice(1));
            if (!parsed.identifier) {
                await cmdDefault(parsed.options);
            }
            else {
                await cmdSwitch(parsed.identifier, parsed.options);
            }
            break;
        }
        case "gui-switch":
        case "gui-use": {
            const parsed = parseSwitchArgs(args.slice(1), { restartCodexGui: true });
            if (!parsed.identifier) {
                await cmdDefault(parsed.options);
            }
            else {
                await cmdSwitch(parsed.identifier, parsed.options);
            }
            break;
        }
        case "remove":
        case "rm":
            if (!args[1]) {
                console.error("Usage: aa remove <email>");
                process.exit(1);
            }
            await cmdRemove(args[1]);
            break;
        case "status":
            await cmdStatus();
            break;
        case "usage":
            await cmdUsage(args[1]);
            break;
        case "add-admin-key":
            await cmdAddAdminKey();
            break;
        case "list-admin-keys":
        case "admin-keys":
            await cmdListAdminKeys();
            break;
        case "remove-admin-key":
            if (!args[1]) {
                console.error("Usage: aa remove-admin-key <label>");
                process.exit(1);
            }
            await cmdRemoveAdminKey(args[1]);
            break;
        case "attach-project": {
            if (!args[1]) {
                console.error("Usage: aa attach-project <api-key-label> [--project-id <id-or-name>]");
                process.exit(1);
            }
            const flagIdx = args.indexOf("--project-id");
            const projectId = flagIdx > -1 ? args[flagIdx + 1] : undefined;
            await cmdAttachProject(args[1], { projectId });
            break;
        }
        case "__refresh-usage":
            await cmdRefreshUsageBackground();
            break;
        case "claude":
            await claudeMain(args.slice(1));
            break;
        case "help":
        case "--help":
        case "-h":
            console.log(HELP);
            break;
        default:
            // If arg looks like an email, treat as status for that account
            if (command.includes("@")) {
                const account = findAccount(command);
                if (account) {
                    try {
                        const usage = await loadAccountUsage(account.email, account.auth, account.email === detectActiveAccount());
                        displayAllUsage([usage]);
                    }
                    catch (err) {
                        console.error(`Error fetching usage for ${command}: ${err.message}`);
                        process.exit(1);
                    }
                }
                else {
                    console.error(`No account found for ${command}.`);
                    process.exit(1);
                }
            }
            else {
                console.error(`Unknown command: ${command}`);
                console.log(HELP);
                process.exit(1);
            }
    }
}
async function cmdAllStatus() {
    console.log("\n\x1b[1mCodex\x1b[0m");
    await cmdStatus();
    console.log("\x1b[1mClaude Code\x1b[0m");
    await claudeStatus();
    console.log("\x1b[1mGrok Build\x1b[0m");
    await grokStatus();
}
async function cmdLiveStatus(args, intervalSeconds) {
    let render;
    if (args.length === 0 || (args.length === 1 && args[0] === "status")) {
        render = cmdAllStatus;
    }
    else if (args[0] === "codex" && (args.length === 1 || (args.length === 2 && args[1] === "status"))) {
        render = cmdStatus;
    }
    else if (args[0] === "claude" && (args.length === 1 || (args.length === 2 && args[1] === "status"))) {
        render = claudeStatus;
    }
    else if (args[0] === "grok" && (args.length === 1 || (args.length === 2 && args[1] === "status"))) {
        render = grokStatus;
    }
    if (!render) {
        throw new Error("--live is supported by status views: aa status, aa codex status, aa claude status, or aa grok status.");
    }
    await runLive(render, intervalSeconds);
}
async function main() {
    const parsed = parseLiveArgs(process.argv.slice(2));
    const args = parsed.args;
    if (parsed.options.enabled) {
        return cmdLiveStatus(args, parsed.options.intervalSeconds);
    }
    const command = args[0];
    if (!command || command === "status")
        return cmdAllStatus();
    switch (command) {
        case "codex":
            return codexMain(args.slice(1));
        case "claude":
            return claudeMain(args.slice(1));
        case "grok":
            return grokMain(args.slice(1));
        case "help":
        case "--help":
        case "-h":
            console.log(HELP);
            return;
        default:
            return codexMain(args);
    }
}
main().catch((err) => {
    console.error(err.message);
    process.exit(1);
});
//# sourceMappingURL=index.js.map