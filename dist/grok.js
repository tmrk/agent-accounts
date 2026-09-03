import { spawn } from "node:child_process";
import { cleanupGrokInstance, createGrokProfile, createTempGrokInstance, detectGrokCli, fetchGrokUsageForPath, findGrokProfile, getActiveGrokProfile, getGrokInstancePath, listGrokProfiles, readGrokAuth, registerGrokProfile, removeGrokProfile, setActiveGrokProfile, validateGrokProfileName, } from "./grok-store.js";
import { displayGrokProfiles, displayGrokProfilesNumbered } from "./display.js";
import { questionOrEscape } from "./interactive.js";
import { alreadyActiveOutcome } from "./live.js";
const HELP = `aa grok - Manage multiple Grok Build accounts

Usage:
  aa grok                         Show profiles and switch interactively
  aa grok add [name]              Add account with browser OAuth
  aa grok add [name] --device-auth
  aa grok list                    List profiles with Grok Build usage
  aa grok switch [name]           Switch the active profile
  aa grok remove <name>           Remove a profile and its isolated home
  aa grok env                     Print export GROK_HOME=...
  aa grok run [name] [...]        Launch Grok Build with a profile
  aa grok <name> [...]            Shorthand for 'aa grok run <name>'
  aa grok help                    Show this help

Shell integration (add to ~/.zshrc or ~/.bashrc):
  eval "$(aa grok env)"
`;
export function parseGrokAddArgs(args) {
    const parsed = { deviceAuth: false };
    for (const arg of args) {
        if (arg === "--device-auth" || arg === "--device-code") {
            parsed.deviceAuth = true;
        }
        else if (arg.startsWith("-")) {
            throw new Error(`Unknown Grok add option: ${arg}`);
        }
        else if (parsed.name) {
            throw new Error(`Unexpected extra profile name: ${arg}`);
        }
        else {
            parsed.name = arg;
        }
    }
    return parsed;
}
function runInherited(command, args, env) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { stdio: "inherit", env });
        child.once("error", reject);
        child.once("exit", code => resolve(code ?? 1));
    });
}
export async function loadGrokProfiles() {
    const active = getActiveGrokProfile();
    return Promise.all(listGrokProfiles().map(async (profile) => {
        const instancePath = getGrokInstancePath(profile.name);
        const auth = readGrokAuth(instancePath);
        if (!auth) {
            return {
                name: profile.name,
                isActive: profile.name === active,
                createdAt: profile.createdAt,
                auth: null,
            };
        }
        try {
            const fresh = await fetchGrokUsageForPath(instancePath);
            return {
                name: profile.name,
                isActive: profile.name === active,
                createdAt: profile.createdAt,
                auth: fresh.auth,
                usage: fresh.usage,
            };
        }
        catch (error) {
            return {
                name: profile.name,
                isActive: profile.name === active,
                createdAt: profile.createdAt,
                auth,
                error: error.message,
            };
        }
    }));
}
async function cmdAdd(args) {
    const { name, deviceAuth } = parseGrokAddArgs(args);
    const grokPath = detectGrokCli();
    if (!grokPath) {
        throw new Error("Grok Build CLI not found. Install it from https://x.ai/build.");
    }
    if (name) {
        const validationError = validateGrokProfileName(name);
        if (validationError)
            throw new Error(validationError);
        if (findGrokProfile(name)) {
            throw new Error(`Profile "${name}" already exists. Remove it first with 'aa grok remove ${name}'.`);
        }
    }
    let instancePath;
    let dirName;
    if (name) {
        instancePath = createGrokProfile(name);
    }
    else {
        const temp = createTempGrokInstance();
        instancePath = temp.path;
        dirName = temp.dirName;
    }
    console.log(deviceAuth
        ? "Starting Grok Build device-code login in an isolated profile...\n"
        : "Starting Grok Build browser login in an isolated profile...\n");
    const loginArgs = ["login", ...(deviceAuth ? ["--device-auth"] : [])];
    let exitCode = 1;
    try {
        exitCode = await runInherited(grokPath, loginArgs, { ...process.env, GROK_HOME: instancePath });
    }
    catch (error) {
        if (name)
            removeGrokProfile(name);
        else
            cleanupGrokInstance(dirName);
        throw new Error(`Failed to start Grok Build: ${error.message}`);
    }
    const auth = readGrokAuth(instancePath);
    if (exitCode !== 0 || !auth) {
        if (name)
            removeGrokProfile(name);
        else
            cleanupGrokInstance(dirName);
        throw new Error("Grok Build login was not completed. No profile was created.");
    }
    const profileName = name || auth.email || `grok-${auth.user_id.slice(0, 8)}`;
    if (!name) {
        if (findGrokProfile(profileName))
            removeGrokProfile(profileName);
        registerGrokProfile(profileName, dirName);
    }
    setActiveGrokProfile(profileName);
    const identity = auth.email ? ` (${auth.email})` : "";
    console.log(`\nAdded Grok Build profile "${profileName}".${identity}`);
    console.log(`  aa grok run ${profileName}      Launch Grok Build with this account`);
}
export async function grokStatus() {
    displayGrokProfiles(await loadGrokProfiles());
}
function resolveGrokProfileName(name) {
    const exact = findGrokProfile(name);
    if (exact)
        return exact.name;
    const matches = listGrokProfiles().filter(p => p.name.toLowerCase().includes(name.toLowerCase()));
    if (matches.length === 0)
        throw new Error(`No Grok Build profile matching "${name}".`);
    if (matches.length > 1) {
        throw new Error(`Multiple Grok Build profiles match "${name}": ${matches.map(p => p.name).join(", ")}`);
    }
    return matches[0].name;
}
export function activateGrokProfile(name) {
    const selected = resolveGrokProfileName(name);
    if (getActiveGrokProfile() === selected)
        return alreadyActiveOutcome(selected);
    setActiveGrokProfile(selected);
    return {
        status: "switched",
        label: selected,
        hint: `eval "$(aa grok env)"`,
    };
}
async function cmdSwitch(name) {
    if (!name)
        return cmdPromptSwitch();
    const result = activateGrokProfile(name);
    if (result.status !== "switched") {
        console.log(`Already using Grok Build profile: ${result.label}`);
        return;
    }
    console.log(`Active Grok Build profile: ${result.label}`);
    console.log(`Run 'eval "$(aa grok env)"' to select it in this shell, or 'aa grok run ${result.label}'.`);
}
async function cmdPromptSwitch() {
    const infos = await loadGrokProfiles();
    if (infos.length === 0) {
        console.log("No Grok Build profiles. Run 'aa grok add' to create one.");
        return;
    }
    displayGrokProfilesNumbered(infos);
    const answer = await questionOrEscape("Switch to (#, Esc to cancel): ");
    if (answer === undefined || !answer.trim())
        return;
    const index = Number.parseInt(answer.trim(), 10) - 1;
    return cmdSwitch(index >= 0 && index < infos.length ? infos[index].name : answer.trim());
}
function cmdRemove(name) {
    if (!name)
        throw new Error("Usage: aa grok remove <name>");
    if (!removeGrokProfile(name))
        throw new Error(`Grok Build profile "${name}" not found.`);
    console.log(`Removed Grok Build profile: ${name}`);
}
function shellQuote(value) {
    return `'${value.replace(/'/g, `'"'"'`)}'`;
}
function cmdEnv() {
    const active = getActiveGrokProfile();
    if (active)
        console.log(`export GROK_HOME=${shellQuote(getGrokInstancePath(active))}`);
}
async function cmdRun(name, extraArgs) {
    const profileName = name || getActiveGrokProfile();
    if (!profileName)
        throw new Error("No Grok Build profile specified and no active profile set.");
    if (!findGrokProfile(profileName))
        throw new Error(`Grok Build profile "${profileName}" not found.`);
    const grokPath = detectGrokCli();
    if (!grokPath)
        throw new Error("Grok Build CLI not found. Install it from https://x.ai/build.");
    setActiveGrokProfile(profileName);
    const exitCode = await runInherited(grokPath, extraArgs, {
        ...process.env,
        GROK_HOME: getGrokInstancePath(profileName),
    });
    process.exitCode = exitCode;
}
export async function grokMain(args) {
    const command = args[0];
    if (!command)
        return cmdPromptSwitch();
    switch (command) {
        case "add":
        case "login":
            return cmdAdd(args.slice(1));
        case "list":
        case "ls":
        case "status":
            return grokStatus();
        case "switch":
        case "use":
            return cmdSwitch(args[1]);
        case "remove":
        case "rm":
            return cmdRemove(args[1] || "");
        case "env":
            return cmdEnv();
        case "run":
            if (!args[1] || args[1].startsWith("-") || args[1] === "--") {
                return cmdRun(undefined, args.slice(args[1] === "--" ? 2 : 1));
            }
            return cmdRun(args[1], args.slice(2));
        case "help":
        case "--help":
        case "-h":
            console.log(HELP);
            return;
        default:
            if (findGrokProfile(command))
                return cmdRun(command, args.slice(1));
            throw new Error(`Unknown command: aa grok ${command}\n\n${HELP}`);
    }
}
//# sourceMappingURL=grok.js.map