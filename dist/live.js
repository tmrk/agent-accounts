import { emitKeypressEvents } from "node:readline";
import { composeDashboardFrame } from "./display.js";
import { dashboardWidth, enterDashboardScreen, leaveDashboardScreen, paintFrame, restoreCookedMode, terminalSize, } from "./term.js";
export const DEFAULT_LIVE_INTERVAL_SECONDS = 30;
export const MIN_LIVE_INTERVAL_SECONDS = 5;
export const MAX_LIVE_INTERVAL_SECONDS = 60 * 60;
function parseInterval(value) {
    const seconds = Number(value);
    if (!Number.isInteger(seconds)
        || seconds < MIN_LIVE_INTERVAL_SECONDS
        || seconds > MAX_LIVE_INTERVAL_SECONDS) {
        throw new Error(`--interval must be a whole number from ${MIN_LIVE_INTERVAL_SECONDS} to ${MAX_LIVE_INTERVAL_SECONDS} seconds.`);
    }
    return seconds;
}
/** True for the all-providers status view (`aa` or `aa status`). */
export function isDefaultStatusCommand(args) {
    return args.length === 0 || (args.length === 1 && args[0] === "status");
}
/** Enter the live dashboard in a TTY unless `--once` was passed. */
export function shouldRunLiveDashboard(args, options, tty = {
    stdinIsTTY: Boolean(process.stdin.isTTY),
    stdoutIsTTY: Boolean(process.stdout.isTTY),
}) {
    if (options.once)
        return false;
    if (options.enabled)
        return true;
    return isDefaultStatusCommand(args) && tty.stdoutIsTTY && tty.stdinIsTTY;
}
/** Pull global live-view flags out of a command without disturbing other arguments. */
export function parseLiveArgs(args) {
    const remaining = [];
    let enabled = false;
    let once = false;
    let intervalSeconds = DEFAULT_LIVE_INTERVAL_SECONDS;
    let hasInterval = false;
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
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
        if (arg === "--once") {
            once = true;
            continue;
        }
        if (arg === "--interval") {
            const value = args[++i];
            if (value === undefined)
                throw new Error("--interval requires a value in seconds.");
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
    if (once && enabled) {
        throw new Error("Use either --live or --once, not both.");
    }
    if (hasInterval && once) {
        throw new Error("--interval cannot be used together with --once.");
    }
    if (hasInterval && !enabled && !isDefaultStatusCommand(remaining)) {
        throw new Error("--interval can only be used with the live dashboard (`aa`, `aa status`, or --live).");
    }
    return {
        args: remaining,
        options: { enabled, once, intervalSeconds },
    };
}
export function interpretKey(input, raw) {
    const name = (input.name ?? "").toLowerCase();
    if (input.ctrl && name === "c")
        return { type: "quit" };
    if (name === "escape" || name === "q")
        return { type: "quit" };
    if (name === "r")
        return { type: "refresh" };
    if (name === "return")
        return { type: "submit" };
    if (name === "backspace" || name === "delete")
        return { type: "backspace" };
    const digit = raw ?? input.sequence ?? input.name ?? "";
    if (/^[0-9]$/.test(digit))
        return { type: "digit", value: digit };
    return { type: "ignore" };
}
/**
 * Decide whether a typed number is a complete selection.
 * If another digit could still form a valid index, wait.
 */
export function commitTypedNumber(buffer, count) {
    if (!buffer)
        return { type: "wait" };
    const index = Number.parseInt(buffer, 10);
    if (!Number.isInteger(index) || index < 1)
        return { type: "invalid" };
    if (index > count)
        return { type: "invalid" };
    if (index * 10 <= count)
        return { type: "wait" };
    return { type: "select", index };
}
export function alreadyActiveOutcome(label) {
    return { status: "already-active", label };
}
function defaultHelp(count) {
    const switchHelp = count === 1 ? "1 switch · " : count > 1 ? `1-${count} switch · ` : "";
    return `${switchHelp}r refresh · q quit`;
}
function formatOutcome(result) {
    if (result.status === "already-active")
        return `Already using ${result.label}`;
    if (result.status === "switched") {
        return result.hint ? `Switched to ${result.label} · ${result.hint}` : `Switched to ${result.label}`;
    }
    return result.label ? `Invalid selection: ${result.label}` : "Invalid selection";
}
/** Re-render a usage view until interrupted, without flashing the terminal. */
export async function runLive(options) {
    const stdout = options.stdout ?? process.stdout;
    const stdin = options.stdin ?? process.stdin;
    const interactive = Boolean(stdout.isTTY);
    const getSize = options.size ?? (() => terminalSize(stdout));
    if (!interactive) {
        return runPlainLive(options);
    }
    let stopping = false;
    let data;
    let updatedAt;
    let message;
    let refreshing = false;
    let numberBuffer = "";
    let wake;
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
        const chrome = {
            title: options.title ?? "Live usage",
            updatedAt,
            intervalSeconds: options.intervalSeconds,
            refreshing,
            message: numberBuffer ? `Switch to #${numberBuffer}_` : message,
            help: options.help ?? defaultHelp(accounts.length),
        };
        paintFrame(composeDashboardFrame(body, chrome, size), size, stdout);
    };
    const loadAndPaint = async (reason) => {
        const generation = ++loadGeneration;
        refreshing = reason !== "initial";
        if (reason === "refresh")
            message = undefined;
        paint();
        try {
            const next = await options.load();
            if (generation !== loadGeneration || stopping)
                return;
            data = next;
            updatedAt = new Date();
            refreshing = false;
            paint();
        }
        catch (error) {
            if (generation !== loadGeneration || stopping)
                return;
            refreshing = false;
            message = error instanceof Error ? error.message : String(error);
            paint();
        }
    };
    const onResize = () => {
        paint();
    };
    const applyNumber = async (commit) => {
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
            if (result.status === "switched")
                await loadAndPaint("switch");
            else
                paint();
        }
        catch (error) {
            message = error instanceof Error ? error.message : String(error);
            paint();
        }
    };
    const onKeypress = (raw, key) => {
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
            if (action.value === "0" && numberBuffer === "")
                return;
            numberBuffer += action.value;
            const count = data ? options.accounts(data).length : 0;
            const commit = commitTypedNumber(numberBuffer, count);
            if (commit.type === "wait")
                paint();
            else
                void applyNumber(commit);
        }
    };
    emitKeypressEvents(stdin);
    stdin.on("keypress", onKeypress);
    stdout.on("resize", onResize);
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    try {
        if (stdin.isTTY && typeof stdin.setRawMode === "function")
            stdin.setRawMode(true);
        stdin.resume();
        enterDashboardScreen(stdout);
        paint();
        await loadAndPaint("initial");
        while (!stopping) {
            await new Promise((resolve) => {
                const timer = setTimeout(resolve, options.intervalSeconds * 1000);
                wake = () => {
                    clearTimeout(timer);
                    resolve();
                };
            });
            wake = undefined;
            if (stopping)
                break;
            await loadAndPaint("refresh");
        }
    }
    finally {
        process.off("SIGINT", stop);
        process.off("SIGTERM", stop);
        stdout.off("resize", onResize);
        stdin.off("keypress", onKeypress);
        restoreCookedMode(stdin);
        leaveDashboardScreen(stdout);
    }
}
async function runPlainLive(options) {
    let stopping = false;
    let first = true;
    let wake;
    const stop = () => {
        stopping = true;
        wake?.();
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    try {
        while (!stopping) {
            if (!first)
                console.log("\n---");
            first = false;
            const updatedAt = new Date().toLocaleTimeString();
            console.log(`Live usage (updated ${updatedAt}; refresh ${options.intervalSeconds}s; Ctrl-C to stop)`);
            try {
                const data = await options.load();
                const width = dashboardWidth();
                console.log(options.render(data, width).join("\n"));
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                console.error(`\nRefresh failed: ${message}`);
            }
            if (stopping)
                break;
            await new Promise((resolve) => {
                const timer = setTimeout(resolve, options.intervalSeconds * 1000);
                wake = () => {
                    clearTimeout(timer);
                    resolve();
                };
            });
            wake = undefined;
        }
    }
    finally {
        process.off("SIGINT", stop);
        process.off("SIGTERM", stop);
    }
}
//# sourceMappingURL=live.js.map