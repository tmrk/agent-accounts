import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import {
  createProfile, listProfiles, findProfile, removeProfile,
  getActiveProfile, setActiveProfile, getInstancePath,
  detectClaudeCli, getAuthStatusAsync, getAuthStatusForPath,
  validateProfileName, createTempInstance, registerProfile,
  cleanupInstance, readCredential, fetchClaudeUsage,
  ensureFreshClaudeCredential, ClaudeUsageError,
  readClaudeUsageCache, writeClaudeUsageCache,
} from "./claude-store.js";
import { displayClaudeProfiles, displayClaudeProfilesNumbered } from "./display.js";
import { questionOrEscape } from "./interactive.js";
import { alreadyActiveOutcome, type SwitchOutcome } from "./live.js";
import type { ClaudeProfileInfo } from "./types.js";

const HELP = `aa claude - Manage multiple Claude Code profiles

Usage:
  aa claude                     Show profiles and switch interactively
  aa claude add [name]          Add account (opens OAuth login, infers email)
  aa claude list                List all profiles with auth status
  aa claude switch [name]       Switch active profile
  aa claude remove <name>       Remove a profile
  aa claude env                 Print export CLAUDE_CONFIG_DIR=...
  aa claude run [name] [...]    Launch Claude with a specific profile
  aa claude <name> [...]        Shorthand for 'aa claude run <name>'
  aa claude help                Show this help

Shell integration (add to ~/.zshrc or ~/.bashrc):
  eval "$(aa claude env)"
`;

/** Fetch auth status, credentials, and usage for all profiles in parallel */
export async function loadClaudeProfiles(): Promise<ClaudeProfileInfo[]> {
  const profiles = listProfiles();
  const active = getActiveProfile();

  // Phase 1: fetch auth status and credentials in parallel
  const withCreds = await Promise.all(
    profiles.map(async (p) => {
      try {
        const instancePath = getInstancePath(p.name);
        const [auth, credential] = await Promise.all([
          getAuthStatusAsync(p.name),
          readCredential(instancePath),
        ]);
        return { profile: p, auth, credential, error: undefined };
      } catch (err) {
        return { profile: p, auth: null, credential: null, error: (err as Error).message };
      }
    })
  );

  // Phase 2: fetch usage for all profiles with valid tokens in parallel
  const infos = await Promise.all(
    withCreds.map(async ({ profile: p, auth, credential, error }): Promise<ClaudeProfileInfo> => {
      let usage = null;
      let usageError: string | undefined;
      let usageCachedAt: string | undefined;
      if (credential?.accessToken && !error) {
        const cached = readClaudeUsageCache(p.name);
        try {
          credential = await ensureFreshClaudeCredential(getInstancePath(p.name), credential);
          const retryAfterAt = cached?.retryAfterAt ? new Date(cached.retryAfterAt).getTime() : 0;
          if (retryAfterAt > Date.now()) {
            usage = cached?.usage ?? null;
            usageCachedAt = cached?.fetchedAt;
            usageError = `usage rate limited; retry in ${Math.max(1, Math.ceil((retryAfterAt - Date.now()) / 60000))}m`;
          } else {
            usage = await fetchClaudeUsage(credential.accessToken!);
            usageCachedAt = new Date().toISOString();
            writeClaudeUsageCache(p.name, { usage, fetchedAt: usageCachedAt });
          }
        } catch (usageErr) {
          usage = cached?.usage ?? null;
          usageCachedAt = cached?.fetchedAt;
          if (usageErr instanceof ClaudeUsageError && usageErr.status === 429) {
            const seconds = usageErr.retryAfterSeconds ?? 300;
            const retryAfterAt = new Date(Date.now() + seconds * 1000).toISOString();
            writeClaudeUsageCache(p.name, { usage: cached?.usage, fetchedAt: cached?.fetchedAt, retryAfterAt });
            usageError = `usage rate limited; retry in ${Math.max(1, Math.ceil(seconds / 60))}m`;
          } else {
            usageError = (usageErr as Error).message;
          }
        }
      }
      return {
        name: p.name,
        isActive: p.name === active,
        createdAt: p.createdAt,
        auth,
        credential,
        usage,
        usageError,
        usageCachedAt,
        error,
      };
    })
  );

  return infos;
}

/** Create a new profile and open Claude for OAuth login.
 *  If name is provided, use it as the profile key.
 *  If not, login first in a temp dir, detect email, use email as key. */
async function cmdAdd(name?: string): Promise<void> {
  const claudePath = detectClaudeCli();
  if (!claudePath) {
    console.error("Claude CLI not found. Install from: https://claude.ai/download");
    process.exit(1);
  }

  // Named flow: validate + create profile dir upfront
  if (name) {
    const validationError = validateProfileName(name);
    if (validationError) {
      console.error(validationError);
      process.exit(1);
    }
    if (findProfile(name)) {
      console.error(`Profile "${name}" already exists. Remove first: aa claude remove ${name}`);
      process.exit(1);
    }
  }

  // Create instance directory — temp dir if no name (stable, never renamed)
  let instancePath: string;
  let dirName: string | undefined;
  if (name) {
    instancePath = createProfile(name);
  } else {
    const temp = createTempInstance();
    instancePath = temp.path;
    dirName = temp.dirName;
  }

  console.log("Starting Claude Code...");
  console.log("Complete the OAuth login in your browser, then exit Claude to finish setup.\n");

  return new Promise((resolve) => {
    // Trap SIGINT in parent so Ctrl+C doesn't kill us before we can
    // handle the child's exit (child gets SIGINT via process group)
    const ignoreInt = () => {};
    process.on("SIGINT", ignoreInt);

    const child = spawn(claudePath, [], {
      stdio: "inherit",
      env: { ...process.env, CLAUDE_CONFIG_DIR: instancePath },
    });

    child.on("error", (err) => {
      process.removeListener("SIGINT", ignoreInt);
      if (name) removeProfile(name); else cleanupInstance(dirName!);
      console.error(`Failed to start Claude: ${err.message}`);
      process.exit(1);
    });

    child.on("exit", async () => {
      process.removeListener("SIGINT", ignoreInt);

      // Always check auth status — credentials persist regardless of exit code
      let auth;
      try {
        auth = await getAuthStatusForPath(instancePath);
      } catch { /* ignore */ }

      if (auth?.loggedIn) {
        const profileName = name || auth.email || "default";

        // Unnamed flow: register the temp instance dir as a real profile (no rename)
        if (!name) {
          if (findProfile(profileName)) removeProfile(profileName);
          registerProfile(profileName, dirName!);
        }

        const displayEmail = auth.email ? ` (${auth.email})` : "";
        const displayPlan = auth.subscriptionType ? ` [${auth.subscriptionType}]` : "";
        console.log(`\nAdded Claude profile "${profileName}".${displayEmail}${displayPlan}`);
        console.log(`\n  aa claude switch ${profileName}   Set as active profile`);
        console.log(`  aa claude run ${profileName}      Launch Claude with this profile`);
        resolve();
      } else {
        // Not logged in — clean up
        if (name) removeProfile(name); else cleanupInstance(dirName!);
        console.error("\nLogin was not completed. No profile was created.");
        process.exit(1);
      }
    });
  });
}

export async function claudeStatus(): Promise<void> {
  displayClaudeProfiles(await loadClaudeProfiles());
}

function resolveClaudeProfileName(name: string): string {
  if (findProfile(name)) return name;
  const matches = listProfiles().filter(p => p.name.toLowerCase().includes(name.toLowerCase()));
  if (matches.length === 0) throw new Error(`No profile matching "${name}".`);
  if (matches.length > 1) {
    throw new Error(`Multiple matches for "${name}":\n${matches.map(m => `  ${m.name}`).join("\n")}`);
  }
  return matches[0]!.name;
}

export function activateClaudeProfile(name: string): SwitchOutcome {
  const selected = resolveClaudeProfileName(name);
  if (getActiveProfile() === selected) return alreadyActiveOutcome(selected);
  setActiveProfile(selected);
  return {
    status: "switched",
    label: selected,
    hint: `eval "$(aa claude env)"`,
  };
}

async function cmdSwitch(name?: string): Promise<void> {
  if (!name) return cmdPromptSwitch();

  let result: SwitchOutcome;
  try {
    result = activateClaudeProfile(name);
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }

  if (result.status !== "switched") {
    console.log(`Already using Claude profile: ${result.label}`);
    return;
  }

  const instancePath = getInstancePath(result.label);
  console.log(`Active Claude profile: ${result.label}`);
  console.log(`\n  export CLAUDE_CONFIG_DIR=${instancePath}`);
  console.log(`\nOr add to shell rc: eval "$(aa claude env)"`);
}

async function cmdPromptSwitch(): Promise<void> {
  const infos = await loadClaudeProfiles();
  if (infos.length === 0) {
    console.log("No profiles. Run 'aa claude add' to create one.");
    return;
  }
  displayClaudeProfilesNumbered(infos);

  const answer = await questionOrEscape("Switch to (#, Esc to cancel): ");
  if (answer === undefined) return;

  const trimmed = answer.trim();
  if (!trimmed) return;

  const idx = parseInt(trimmed, 10) - 1;
  if (idx >= 0 && idx < infos.length) return cmdSwitch(infos[idx]!.name);
  return cmdSwitch(trimmed);
}

async function cmdRemove(name: string): Promise<void> {
  if (!name) {
    console.error("Usage: aa claude remove <name>");
    process.exit(1);
  }
  if (!findProfile(name)) {
    console.error(`Profile "${name}" not found.`);
    process.exit(1);
  }
  removeProfile(name);
  console.log(`Removed Claude profile: ${name}`);
}

/** Print export command for active profile (safe for eval) */
function cmdEnv(): void {
  const active = getActiveProfile();
  if (!active) return;
  console.log(`export CLAUDE_CONFIG_DIR=${getInstancePath(active)}`);
}

/** Launch Claude with a specific profile, passing through extra args */
async function cmdRun(name: string | undefined, extraArgs: string[]): Promise<void> {
  const profileName = name || getActiveProfile();
  if (!profileName) {
    console.error("No profile specified and no active profile set.");
    console.error("Usage: aa claude run <name>");
    process.exit(1);
  }
  if (!findProfile(profileName)) {
    console.error(`Profile "${profileName}" not found.`);
    process.exit(1);
  }

  const claudePath = detectClaudeCli();
  if (!claudePath) {
    console.error("Claude CLI not found. Install from: https://claude.ai/download");
    process.exit(1);
  }

  setActiveProfile(profileName);
  const instancePath = getInstancePath(profileName);

  const child = spawn(claudePath, extraArgs, {
    stdio: "inherit",
    env: { ...process.env, CLAUDE_CONFIG_DIR: instancePath },
  });

  child.on("error", (err) => {
    console.error(`Failed to start Claude: ${err.message}`);
    process.exit(1);
  });

  child.on("exit", (code) => process.exit(code ?? 0));

  // Keep alive until child exits
  return new Promise(() => {});
}

/** Interactive default: list profiles + prompt to switch */
async function cmdDefault(): Promise<void> {
  const profiles = listProfiles();
  if (profiles.length === 0) {
    console.log("No Claude profiles. Run 'aa claude add' to create one.");
    return;
  }
  return cmdPromptSwitch();
}

/** Main router for 'aa claude ...' subcommands */
export async function claudeMain(args: string[]): Promise<void> {
  const cmd = args[0];
  if (!cmd) return cmdDefault();

  switch (cmd) {
    case "add":
    case "login":
      return cmdAdd(args[1] || undefined);
    case "list":
    case "ls":
      return claudeStatus();
    case "switch":
    case "use":
      return cmdSwitch(args[1]);
    case "remove":
    case "rm":
      return cmdRemove(args[1] || "");
    case "env":
      cmdEnv();
      return;
    case "status":
      return claudeStatus();
    case "run":
      return cmdRun(args[1], args.slice(2));
    case "help":
    case "--help":
    case "-h":
      console.log(HELP);
      return;
    default:
      // If arg matches a profile name, launch Claude with it
      if (findProfile(cmd)) {
        return cmdRun(cmd, args.slice(1));
      }
      console.error(`Unknown command: aa claude ${cmd}`);
      console.log(HELP);
      process.exit(1);
  }
}
