import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { STORE_DIR } from "./paths.js";
import { getCodexHome } from "./store.js";

const STAMP_NAME = "codex-daemon-account.json";
const DEFAULT_RESTART_TIMEOUT_MS = 20_000;

/**
 * Codex 0.157+ attaches new CLI sessions to a shared app-server daemon that
 * reads auth.json once. Replacing the file does not change the account, or the
 * five-hour limit, until that process starts again.
 */
export interface DaemonIdentity {
  pid: number;
  processStartTime: string;
}

interface DaemonStamp extends DaemonIdentity {
  accountKey: string;
}

export type CodexDaemonSync =
  | { status: "not-running" }
  | { status: "current" }
  | { status: "restarted" }
  | { status: "failed"; message: string };

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type CommandRunner = (
  command: string,
  args: string[],
  options?: { timeoutMs?: number; env?: NodeJS.ProcessEnv },
) => Promise<CommandResult>;

export function codexAppServerControlSocket(codexHome = getCodexHome()): string {
  return join(codexHome, "app-server-control", "app-server-control.sock");
}

export function codexDaemonPidPath(codexHome = getCodexHome()): string {
  return join(codexHome, "app-server-daemon", "daemon.pid");
}

export function codexDaemonStampPath(): string {
  return join(STORE_DIR, STAMP_NAME);
}

/** True when the control socket resolves to a live socket, including via a symlink. */
export function isCodexAppServerDaemonRunning(codexHome = getCodexHome()): boolean {
  try {
    return statSync(codexAppServerControlSocket(codexHome)).isSocket();
  } catch {
    return false;
  }
}

export function readCodexDaemonIdentity(codexHome = getCodexHome()): DaemonIdentity | null {
  try {
    const raw = JSON.parse(readFileSync(codexDaemonPidPath(codexHome), "utf-8")) as {
      pid?: unknown;
      processStartTime?: unknown;
    };
    if (typeof raw.pid !== "number" || !Number.isFinite(raw.pid)) return null;
    if (typeof raw.processStartTime !== "string" || raw.processStartTime.trim() === "") return null;
    return { pid: raw.pid, processStartTime: raw.processStartTime };
  } catch {
    return null;
  }
}

function readDaemonStamp(stampPath: string): DaemonStamp | null {
  try {
    const raw = JSON.parse(readFileSync(stampPath, "utf-8")) as Partial<DaemonStamp>;
    if (typeof raw.accountKey !== "string" || raw.accountKey === "") return null;
    if (typeof raw.pid !== "number" || !Number.isFinite(raw.pid)) return null;
    if (typeof raw.processStartTime !== "string" || raw.processStartTime === "") return null;
    return { accountKey: raw.accountKey, pid: raw.pid, processStartTime: raw.processStartTime };
  } catch {
    return null;
  }
}

function writeDaemonStamp(stampPath: string, stamp: DaemonStamp): void {
  mkdirSync(dirname(stampPath), { recursive: true, mode: 0o700 });
  writeFileSync(stampPath, JSON.stringify(stamp), { mode: 0o600 });
}

function sameIdentity(left: DaemonIdentity | null, right: DaemonIdentity | null): boolean {
  return !!left && !!right && left.pid === right.pid && left.processStartTime === right.processStartTime;
}

export function daemonAlreadyHasAccount(
  accountKey: string,
  codexHome = getCodexHome(),
  stampPath = codexDaemonStampPath(),
): boolean {
  const identity = readCodexDaemonIdentity(codexHome);
  const stamp = readDaemonStamp(stampPath);
  if (!identity || !stamp) return false;
  return stamp.accountKey === accountKey && sameIdentity(stamp, identity);
}

function failureDetail(result: CommandResult): string {
  const text = (result.stderr || result.stdout).replace(/\s+/g, " ").trim();
  if (!text) return `exit ${result.code}`;
  return text.length > 240 ? `${text.slice(0, 237)}...` : text;
}

function runCommand(
  command: string,
  args: string[],
  options?: { timeoutMs?: number; env?: NodeJS.ProcessEnv },
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: options?.env ?? process.env,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      fn();
    };
    const timer = options?.timeoutMs
      ? setTimeout(() => {
          child.kill("SIGTERM");
          finish(() => reject(new Error(`codex app-server daemon restart timed out after ${options.timeoutMs}ms`)));
        }, options.timeoutMs)
      : undefined;
    child.stdout.on("data", chunk => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", chunk => {
      stderr += chunk.toString();
    });
    child.on("error", err => finish(() => reject(err)));
    child.on("close", code => finish(() => resolve({ code: code ?? 1, stdout, stderr })));
  });
}

export interface SyncCodexDaemonOptions {
  codexHome?: string;
  stampPath?: string;
  /** Restart even when this process was already restarted onto accountKey. */
  force?: boolean;
  runner?: CommandRunner;
  isRunning?: (codexHome: string) => boolean;
  timeoutMs?: number;
}

/**
 * Restart a running Codex app-server so it re-reads auth.json.
 * A stopped daemon is left alone; the next `codex` start loads the file itself.
 * Re-selecting the account this process was already restarted onto does nothing.
 */
export async function syncCodexAppServerDaemon(
  accountKey: string,
  options: SyncCodexDaemonOptions = {},
): Promise<CodexDaemonSync> {
  const codexHome = options.codexHome ?? getCodexHome();
  const stampPath = options.stampPath ?? codexDaemonStampPath();
  const running = (options.isRunning ?? isCodexAppServerDaemonRunning)(codexHome);
  if (!running) return { status: "not-running" };
  if (!options.force && daemonAlreadyHasAccount(accountKey, codexHome, stampPath)) {
    return { status: "current" };
  }

  const before = readCodexDaemonIdentity(codexHome);
  const runner = options.runner ?? runCommand;
  let result: CommandResult;
  try {
    result = await runner("codex", ["app-server", "daemon", "restart"], {
      timeoutMs: options.timeoutMs ?? DEFAULT_RESTART_TIMEOUT_MS,
      env: { ...process.env, CODEX_HOME: codexHome },
    });
  } catch (err) {
    return { status: "failed", message: (err as Error).message };
  }
  if (result.code !== 0) {
    return { status: "failed", message: failureDetail(result) };
  }

  const after = readCodexDaemonIdentity(codexHome);
  if (!after || sameIdentity(before, after)) {
    return {
      status: "failed",
      message: "codex app-server daemon restart did not replace the running server",
    };
  }
  writeDaemonStamp(stampPath, { accountKey, ...after });
  return { status: "restarted" };
}
