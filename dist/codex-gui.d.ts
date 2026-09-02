export interface CommandResult {
    code: number;
    stdout: string;
    stderr: string;
}
export type CommandRunner = (command: string, args: string[]) => Promise<CommandResult>;
export type RestartCodexGuiResult = {
    status: "restarted";
} | {
    status: "not-running";
} | {
    status: "unsupported";
    message: string;
} | {
    status: "failed";
    message: string;
};
export declare function restartCodexGui(runner?: CommandRunner, platform?: NodeJS.Platform): Promise<RestartCodexGuiResult>;
