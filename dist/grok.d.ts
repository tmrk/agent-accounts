interface AddArgs {
    name?: string;
    deviceAuth: boolean;
}
export declare function parseGrokAddArgs(args: string[]): AddArgs;
export declare function grokStatus(): Promise<void>;
export declare function grokMain(args: string[]): Promise<void>;
export {};
