/**
 * Codex 0.157+ attaches new CLI sessions to a shared app-server daemon that
 * reads auth.json once. Replacing the file does not change the account, or the
 * five-hour limit, until that process starts again.
 */
export interface DaemonIdentity {
    pid: number;
    processStartTime: string;
}
export type CodexDaemonSync = {
    status: "not-running";
} | {
    status: "current";
} | {
    status: "restarted";
} | {
    status: "failed";
    message: string;
};
export interface CommandResult {
    code: number;
    stdout: string;
    stderr: string;
}
export type CommandRunner = (command: string, args: string[], options?: {
    timeoutMs?: number;
    env?: NodeJS.ProcessEnv;
}) => Promise<CommandResult>;
export declare function codexAppServerControlSocket(codexHome?: string): string;
export declare function codexDaemonPidPath(codexHome?: string): string;
export declare function codexDaemonStampPath(): string;
/** True when the control socket resolves to a live socket, including via a symlink. */
export declare function isCodexAppServerDaemonRunning(codexHome?: string): boolean;
export declare function readCodexDaemonIdentity(codexHome?: string): DaemonIdentity | null;
export declare function daemonAlreadyHasAccount(accountKey: string, codexHome?: string, stampPath?: string): boolean;
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
export declare function syncCodexAppServerDaemon(accountKey: string, options?: SyncCodexDaemonOptions): Promise<CodexDaemonSync>;
