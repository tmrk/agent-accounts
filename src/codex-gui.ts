import { spawn } from "node:child_process";

const CODEX_BUNDLE_ID = "com.openai.codex";
const CODEX_APP_PATH = "/Applications/Codex.app";

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type CommandRunner = (command: string, args: string[]) => Promise<CommandResult>;

export type RestartCodexGuiResult =
  | { status: "restarted" }
  | { status: "not-running" }
  | { status: "unsupported"; message: string }
  | { status: "failed"; message: string };

export async function restartCodexGui(
  runner: CommandRunner = runCommand,
  platform: NodeJS.Platform = process.platform,
): Promise<RestartCodexGuiResult> {
  if (platform !== "darwin") {
    return { status: "unsupported", message: "Codex.app restart is only supported on macOS." };
  }

  const before = await pgrepCodexGui(runner);
  if (before.length === 0) {
    return { status: "not-running" };
  }

  const kill = await runner("pkill", ["-x", "Codex"]);
  if (kill.code !== 0 && kill.code !== 1) {
    return { status: "failed", message: `pkill Codex failed: ${kill.stderr.trim() || `exit ${kill.code}`}` };
  }

  for (let attempt = 0; attempt < 50; attempt++) {
    if ((await pgrepCodexGui(runner)).length === 0) {
      break;
    }
    await delay(100);
  }

  const stillRunning = await pgrepCodexGui(runner);
  if (stillRunning.length > 0) {
    return { status: "failed", message: `Codex.app did not exit cleanly; still running pids: ${stillRunning.join(", ")}` };
  }

  const openByBundle = await runner("open", ["-b", CODEX_BUNDLE_ID]);
  if (openByBundle.code === 0) {
    return { status: "restarted" };
  }

  const openByPath = await runner("open", [CODEX_APP_PATH]);
  if (openByPath.code === 0) {
    return { status: "restarted" };
  }

  return {
    status: "failed",
    message: openByBundle.stderr.trim() || openByPath.stderr.trim() || "failed to reopen Codex.app",
  };
}

async function pgrepCodexGui(runner: CommandRunner): Promise<number[]> {
  const result = await runner("pgrep", ["-x", "Codex"]);
  if (result.code === 1) return [];
  if (result.code !== 0) {
    throw new Error(`pgrep Codex failed: ${result.stderr.trim() || `exit ${result.code}`}`);
  }
  return result.stdout
    .split(/\s+/)
    .map(value => Number.parseInt(value, 10))
    .filter(Number.isFinite);
}

function runCommand(command: string, args: string[]): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", chunk => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", code => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
