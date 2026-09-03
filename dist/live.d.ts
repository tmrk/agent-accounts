import { type ViewSize } from "./term.js";
export declare const DEFAULT_LIVE_INTERVAL_SECONDS = 30;
export declare const MIN_LIVE_INTERVAL_SECONDS = 5;
export declare const MAX_LIVE_INTERVAL_SECONDS: number;
export interface LiveOptions {
    enabled: boolean;
    once: boolean;
    intervalSeconds: number;
}
export interface ParsedLiveArgs {
    args: string[];
    options: LiveOptions;
}
export interface TtyState {
    stdinIsTTY: boolean;
    stdoutIsTTY: boolean;
}
export type DashboardKey = {
    type: "quit";
} | {
    type: "refresh";
} | {
    type: "resize";
} | {
    type: "digit";
    value: string;
} | {
    type: "submit";
} | {
    type: "backspace";
} | {
    type: "ignore";
};
export type NumberCommit = {
    type: "select";
    index: number;
} | {
    type: "wait";
} | {
    type: "invalid";
};
/** True for the all-providers status view (`aa` or `aa status`). */
export declare function isDefaultStatusCommand(args: string[]): boolean;
/** Enter the live dashboard in a TTY unless `--once` was passed. */
export declare function shouldRunLiveDashboard(args: string[], options: LiveOptions, tty?: TtyState): boolean;
/** Pull global live-view flags out of a command without disturbing other arguments. */
export declare function parseLiveArgs(args: string[]): ParsedLiveArgs;
export declare function interpretKey(input: {
    name?: string;
    ctrl?: boolean;
    sequence?: string;
}, raw?: string): DashboardKey;
/**
 * Decide whether a typed number is a complete selection.
 * If another digit could still form a valid index, wait.
 */
export declare function commitTypedNumber(buffer: string, count: number): NumberCommit;
export interface SwitchableAccount {
    index: number;
    provider: "codex" | "claude" | "grok";
    id: string;
    label: string;
    active: boolean;
}
export type SwitchOutcome = {
    status: "switched";
    label: string;
    hint?: string;
} | {
    status: "already-active";
    label: string;
} | {
    status: "invalid";
    label?: string;
};
export declare function alreadyActiveOutcome(label: string): SwitchOutcome;
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
/** Re-render a usage view until interrupted, without flashing the terminal. */
export declare function runLive<T>(options: LiveDashboardOptions<T>): Promise<void>;
