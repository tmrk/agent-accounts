export interface AddOptions {
    deviceAuth: boolean;
}
export declare function parseAddArgs(args: string[]): AddOptions;
/** Args passed to the `codex` binary for login. */
export declare function codexLoginArgs(options: AddOptions): string[];
