/** Terminal size, ANSI-aware clipping, and flicker-free frame painting. */
import { spawnSync } from "node:child_process";
const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;
export const MIN_DASHBOARD_WIDTH = 24;
export const MAX_DASHBOARD_WIDTH = 112;
export const DEFAULT_DASHBOARD_WIDTH = 88;
export const ENTER_ALT_SCREEN = "\x1b[?1049h";
export const LEAVE_ALT_SCREEN = "\x1b[?1049l";
export const HIDE_CURSOR = "\x1b[?25l";
export const SHOW_CURSOR = "\x1b[?25h";
export const DISABLE_WRAP = "\x1b[?7l";
export const ENABLE_WRAP = "\x1b[?7h";
export const RESET_SGR = "\x1b[0m";
export const SYNC_START = "\x1b[?2026h";
export const SYNC_END = "\x1b[?2026l";
export const CURSOR_HOME = "\x1b[H";
export const ERASE_DOWN = "\x1b[J";
export const NORMAL_CURSOR_KEYS = "\x1b[?1l\x1b>";
export const DISABLE_MOUSE = "\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l";
export function visibleLength(value) {
    return value.replace(ANSI_PATTERN, "").length;
}
/** Walk a string by visible columns, preserving ANSI sequences. */
export function truncateVisible(value, width, ellipsis = "…") {
    if (width <= 0)
        return "";
    if (visibleLength(value) <= width)
        return value;
    const suffix = ellipsis.slice(0, width);
    const budget = Math.max(0, width - visibleLength(suffix));
    let visible = 0;
    let out = "";
    for (let i = 0; i < value.length;) {
        if (value[i] === "\x1b") {
            const match = value.slice(i).match(/^\x1b\[[0-9;]*m/);
            if (match) {
                out += match[0];
                i += match[0].length;
                continue;
            }
        }
        if (visible >= budget)
            break;
        out += value[i];
        visible += 1;
        i += 1;
    }
    return `${out}${suffix}`;
}
export function padVisible(value, width) {
    const length = visibleLength(value);
    if (length >= width)
        return truncateVisible(value, width);
    return `${value}${" ".repeat(width - length)}`;
}
export function clampWidth(columns) {
    if (!Number.isFinite(columns) || columns <= 0)
        return DEFAULT_DASHBOARD_WIDTH;
    return Math.max(1, Math.min(MAX_DASHBOARD_WIDTH, Math.floor(columns)));
}
export function terminalSize(stdout = process.stdout, env = process.env) {
    const envColumns = Number(env.COLUMNS);
    const envRows = Number(env.LINES);
    const columns = stdout.columns
        ?? (Number.isFinite(envColumns) && envColumns > 0 ? envColumns : DEFAULT_DASHBOARD_WIDTH);
    const rows = stdout.rows
        ?? (Number.isFinite(envRows) && envRows > 0 ? envRows : 24);
    return {
        columns: Math.max(1, Math.floor(columns)),
        rows: Math.max(1, Math.floor(rows)),
    };
}
export function dashboardWidth(size = terminalSize()) {
    return clampWidth(size.columns);
}
/**
 * Paint a complete frame without clearing the screen first.
 * Home the cursor, write each row padded to the terminal width, then erase
 * leftover cells below. Synchronized-update wrappers avoid tearing on
 * terminals that support them; others ignore the sequences.
 */
export function paintFrame(lines, size, output = process.stdout) {
    const rows = Math.max(1, size.rows);
    const columns = Math.max(1, size.columns);
    const visible = lines.slice(0, rows).map(line => padVisible(line, columns));
    const body = visible.map((line, index) => index === visible.length - 1 ? line : `${line}\n`);
    const sequence = `${SYNC_START}${CURSOR_HOME}${body.join("")}${ERASE_DOWN}${SYNC_END}`;
    output.write(sequence);
    return sequence;
}
export function enterDashboardScreen(output = process.stdout) {
    output.write(`${ENTER_ALT_SCREEN}${HIDE_CURSOR}${DISABLE_WRAP}`);
}
export function leaveDashboardScreen(output = process.stdout) {
    output.write(`${RESET_SGR}${LEAVE_ALT_SCREEN}${ENABLE_WRAP}${SHOW_CURSOR}${NORMAL_CURSOR_KEYS}${DISABLE_MOUSE}\r\n`);
}
/** Put the tty back into cooked mode so the shell can read arrow keys again. */
export function restoreCookedMode(stdin = process.stdin) {
    try {
        if (stdin.isTTY && typeof stdin.setRawMode === "function") {
            stdin.setRawMode(false);
        }
    }
    catch {
        // Some test doubles and embedded PTYs reject raw-mode changes.
    }
    if (stdin.isTTY) {
        spawnSync("stty", ["sane"], {
            stdio: [stdin, "ignore", "ignore"],
        });
    }
    try {
        stdin.pause();
    }
    catch {
        // Ignore pause failures; the process is exiting.
    }
}
//# sourceMappingURL=term.js.map