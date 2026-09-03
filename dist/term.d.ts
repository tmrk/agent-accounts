/** Terminal size, ANSI-aware clipping, and flicker-free frame painting. */
export declare const MIN_DASHBOARD_WIDTH = 24;
export declare const MAX_DASHBOARD_WIDTH = 112;
export declare const DEFAULT_DASHBOARD_WIDTH = 88;
export declare const ENTER_ALT_SCREEN = "\u001B[?1049h";
export declare const LEAVE_ALT_SCREEN = "\u001B[?1049l";
export declare const HIDE_CURSOR = "\u001B[?25l";
export declare const SHOW_CURSOR = "\u001B[?25h";
export declare const DISABLE_WRAP = "\u001B[?7l";
export declare const ENABLE_WRAP = "\u001B[?7h";
export declare const RESET_SGR = "\u001B[0m";
export declare const SYNC_START = "\u001B[?2026h";
export declare const SYNC_END = "\u001B[?2026l";
export declare const CURSOR_HOME = "\u001B[H";
export declare const ERASE_DOWN = "\u001B[J";
export interface ViewSize {
    columns: number;
    rows: number;
}
export declare function visibleLength(value: string): number;
/** Walk a string by visible columns, preserving ANSI sequences. */
export declare function truncateVisible(value: string, width: number, ellipsis?: string): string;
export declare function padVisible(value: string, width: number): string;
export declare function clampWidth(columns: number): number;
export declare function terminalSize(stdout?: {
    columns?: number;
    rows?: number;
}, env?: NodeJS.ProcessEnv): ViewSize;
export declare function dashboardWidth(size?: ViewSize): number;
/**
 * Paint a complete frame without clearing the screen first.
 * Home the cursor, write each row padded to the terminal width, then erase
 * leftover cells below. Synchronized-update wrappers avoid tearing on
 * terminals that support them; others ignore the sequences.
 */
export declare function paintFrame(lines: string[], size: ViewSize, output?: {
    write(chunk: string): unknown;
}): string;
export declare function enterDashboardScreen(output?: {
    write(chunk: string): unknown;
}): void;
export declare function leaveDashboardScreen(output?: {
    write(chunk: string): unknown;
}): void;
