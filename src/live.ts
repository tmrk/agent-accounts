import { emitKeypressEvents } from "node:readline";
import { composeDashboardFrame, type LiveChrome } from "./display.js";
import {
  dashboardWidth,
  enterDashboardScreen,
  leaveDashboardScreen,
  paintFrame,
  terminalSize,
  type ViewSize,
} from "./term.js";

export const DEFAULT_LIVE_INTERVAL_SECONDS = 30;
export const MIN_LIVE_INTERVAL_SECONDS = 5;
export const MAX_LIVE_INTERVAL_SECONDS = 60 * 60;

export interface LiveOptions {
  enabled: boolean;
  intervalSeconds: number;
}

export interface ParsedLiveArgs {
  args: string[];
  options: LiveOptions;
}

export type DashboardKey =
  | { type: "quit" }
  | { type: "refresh" }
  | { type: "resize" }
  | { type: "digit"; value: string }
  | { type: "submit" }
  | { type: "backspace" }
  | { type: "ignore" };

export type NumberCommit =
  | { type: "select"; index: number }
  | { type: "wait" }
  | { type: "invalid" };

function parseInterval(value: string): number {
  const seconds = Number(value);
  if (!Number.isInteger(seconds)
    || seconds < MIN_LIVE_INTERVAL_SECONDS
    || seconds > MAX_LIVE_INTERVAL_SECONDS) {
    throw new Error(
      `--interval must be a whole number from ${MIN_LIVE_INTERVAL_SECONDS} to ${MAX_LIVE_INTERVAL_SECONDS} seconds.`,
    );
  }
  return seconds;
}

/** Pull global live-view flags out of a command without disturbing other arguments. */
export function parseLiveArgs(args: string[]): ParsedLiveArgs {
  const remaining: string[] = [];
  let enabled = false;
  let intervalSeconds = DEFAULT_LIVE_INTERVAL_SECONDS;
  let hasInterval = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--live") {
      enabled = true;
      continue;
    }
    if (arg.startsWith("--live=")) {
      enabled = true;
      intervalSeconds = parseInterval(arg.slice("--live=".length));
      hasInterval = true;
      continue;
    }
    if (arg === "--interval") {
      const value = args[++i];
      if (value === undefined) throw new Error("--interval requires a value in seconds.");
      intervalSeconds = parseInterval(value);
      hasInterval = true;
      continue;
    }
    if (arg.startsWith("--interval=")) {
      intervalSeconds = parseInterval(arg.slice("--interval=".length));
      hasInterval = true;
      continue;
    }
    remaining.push(arg);
  }

  if (hasInterval && !enabled) {
    throw new Error("--interval can only be used together with --live.");
  }

  return {
    args: remaining,
    options: { enabled, intervalSeconds },
  };
}

export function interpretKey(input: { name?: string; ctrl?: boolean; sequence?: string }, raw?: string): DashboardKey {
  const name = (input.name ?? "").toLowerCase();
  if (input.ctrl && name === "c") return { type: "quit" };
  if (name === "escape" || name === "q") return { type: "quit" };
  if (name === "r") return { type: "refresh" };
  if (name === "return") return { type: "submit" };
  if (name === "backspace" || name === "delete") return { type: "backspace" };
  const digit = raw ?? input.sequence ?? input.name ?? "";
  if (/^[0-9]$/.test(digit)) return { type: "digit", value: digit };
  return { type: "ignore" };
}

/**
 * Decide whether a typed number is a complete selection.
 * If another digit could still form a valid index, wait.
 */
export function commitTypedNumber(buffer: string, count: number): NumberCommit {
  if (!buffer) return { type: "wait" };
  const index = Number.parseInt(buffer, 10);
  if (!Number.isInteger(index) || index < 1) return { type: "invalid" };
  if (index > count) return { type: "invalid" };
  if (index * 10 <= count) return { type: "wait" };
  return { type: "select", index };
}

export interface SwitchableAccount {
  index: number;
  provider: "codex" | "claude" | "grok";
  id: string;
  label: string;
  active: boolean;
}

export type SwitchOutcome =
  | { status: "switched"; label: string; hint?: string }
  | { status: "already-active"; label: string }
  | { status: "invalid"; label?: string };

export function alreadyActiveOutcome(label: string): SwitchOutcome {
  return { status: "already-active", label };
}

export interface LiveDashboardOptions<T> {
  load: () => Promise<T>;
  render: (data: T, width: number) => string[];
  accounts: (data: T) => SwitchableAccount[];
  onSelect?: (account: SwitchableAccount) => SwitchOutcome | Promise<SwitchOutcome>;
  intervalSeconds: number;
  title?: string;
  help?: string;
  stdout?: NodeJS.WriteStream;
  stdin?: NodeJS.ReadStream;
  size?: () => ViewSize;
}

function defaultHelp(count: number): string {
  const switchHelp = count === 1 ? "1 switch · " : count > 1 ? `1-${count} switch · ` : "";
  return `${switchHelp}r refresh · q quit`;
}

function formatOutcome(result: SwitchOutcome): string {
  if (result.status === "already-active") return `Already using ${result.label}`;
  if (result.status === "switched") {
    return result.hint ? `Switched to ${result.label} · ${result.hint}` : `Switched to ${result.label}`;
  }
  return result.label ? `Invalid selection: ${result.label}` : "Invalid selection";
}

/** Re-render a usage view until interrupted, without flashing the terminal. */
export async function runLive<T>(options: LiveDashboardOptions<T>): Promise<void> {
  const stdout = options.stdout ?? process.stdout;
  const stdin = options.stdin ?? process.stdin;
  const interactive = Boolean(stdout.isTTY);
  const getSize = options.size ?? (() => terminalSize(stdout));

  if (!interactive) {
    return runPlainLive(options);
  }

  let stopping = false;
  let data: T | undefined;
  let updatedAt: Date | undefined;
  let message: string | undefined;
  let refreshing = false;
  let numberBuffer = "";
  let wake: (() => void) | undefined;
  let loadGeneration = 0;

  const stop = () => {
    stopping = true;
    loadGeneration += 1;
    wake?.();
  };

  const paint = () => {
    const size = getSize();
    const width = dashboardWidth(size);
    const accounts = data ? options.accounts(data) : [];
    const body = data ? options.render(data, width) : ["Loading usage…"];
    const chrome: LiveChrome = {
      title: options.title ?? "Live usage",
      updatedAt,
      intervalSeconds: options.intervalSeconds,
      refreshing,
      message: numberBuffer ? `Switch to #${numberBuffer}_` : message,
      help: options.help ?? defaultHelp(accounts.length),
    };
    paintFrame(composeDashboardFrame(body, chrome, size), size, stdout);
  };

  const loadAndPaint = async (reason: "refresh" | "initial" | "switch") => {
    const generation = ++loadGeneration;
    refreshing = reason !== "initial";
    if (reason === "refresh") message = undefined;
    paint();
    try {
      const next = await options.load();
      if (generation !== loadGeneration || stopping) return;
      data = next;
      updatedAt = new Date();
      refreshing = false;
      paint();
    } catch (error) {
      if (generation !== loadGeneration || stopping) return;
      refreshing = false;
      message = error instanceof Error ? error.message : String(error);
      paint();
    }
  };

  const onResize = () => {
    paint();
  };

  const applyNumber = async (commit: NumberCommit) => {
    if (commit.type === "wait") {
      paint();
      return;
    }
    const buffer = numberBuffer;
    numberBuffer = "";
    if (commit.type === "invalid") {
      message = buffer ? `No account ${buffer}` : "Invalid selection";
      paint();
      return;
    }
    const accounts = data ? options.accounts(data) : [];
    const account = accounts.find(item => item.index === commit.index);
    if (!account) {
      message = `No account ${commit.index}`;
      paint();
      return;
    }
    if (!options.onSelect) {
      message = account.active
        ? formatOutcome(alreadyActiveOutcome(account.label))
        : `Selected ${account.label}`;
      paint();
      return;
    }
    try {
      const result = await options.onSelect(account);
      message = formatOutcome(result);
      if (result.status === "switched") await loadAndPaint("switch");
      else paint();
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
      paint();
    }
  };

  const onKeypress = (raw: string, key?: { name?: string; ctrl?: boolean; sequence?: string }) => {
    const action = interpretKey(key ?? {}, raw);
    if (action.type === "quit") {
      stop();
      return;
    }
    if (action.type === "refresh") {
      void loadAndPaint("refresh");
      return;
    }
    if (action.type === "backspace") {
      numberBuffer = numberBuffer.slice(0, -1);
      paint();
      return;
    }
    if (action.type === "submit") {
      void applyNumber(commitTypedNumber(numberBuffer, data ? options.accounts(data).length : 0));
      return;
    }
    if (action.type === "digit") {
      if (action.value === "0" && numberBuffer === "") return;
      numberBuffer += action.value;
      const count = data ? options.accounts(data).length : 0;
      const commit = commitTypedNumber(numberBuffer, count);
      if (commit.type === "wait") paint();
      else void applyNumber(commit);
    }
  };

  emitKeypressEvents(stdin);
  const previousRawMode = stdin.isTTY && typeof stdin.setRawMode === "function"
    ? stdin.isRaw
    : undefined;
  if (stdin.isTTY && typeof stdin.setRawMode === "function") stdin.setRawMode(true);
  stdin.resume();
  stdin.on("keypress", onKeypress);
  stdout.on("resize", onResize);
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  enterDashboardScreen(stdout);
  paint();

  try {
    await loadAndPaint("initial");
    while (!stopping) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, options.intervalSeconds * 1000);
        wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
      wake = undefined;
      if (stopping) break;
      await loadAndPaint("refresh");
    }
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    stdout.off("resize", onResize);
    stdin.off("keypress", onKeypress);
    if (stdin.isTTY && typeof stdin.setRawMode === "function" && previousRawMode === false) {
      stdin.setRawMode(false);
    }
    leaveDashboardScreen(stdout);
  }
}

async function runPlainLive<T>(options: LiveDashboardOptions<T>): Promise<void> {
  let stopping = false;
  let first = true;
  let wake: (() => void) | undefined;
  const stop = () => {
    stopping = true;
    wake?.();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  try {
    while (!stopping) {
      if (!first) console.log("\n---");
      first = false;
      const updatedAt = new Date().toLocaleTimeString();
      console.log(`Live usage (updated ${updatedAt}; refresh ${options.intervalSeconds}s; Ctrl-C to stop)`);
      try {
        const data = await options.load();
        const width = dashboardWidth();
        console.log(options.render(data, width).join("\n"));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`\nRefresh failed: ${message}`);
      }
      if (stopping) break;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, options.intervalSeconds * 1000);
        wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
      wake = undefined;
    }
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}


