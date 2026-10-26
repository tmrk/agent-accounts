export interface AddOptions {
    deviceAuth: boolean;
}
export type AccountProvider = "codex" | "claude" | "grok";
/** `aacc add claude` / `aacc login grok` select a provider. Flat `aacc add` stays Codex. */
export declare function parseProviderInvocation(args: string[]): {
    provider: AccountProvider;
    rest: string[];
} | null;
export declare function parseAddArgs(args: string[]): AddOptions;
/** Args passed to the `codex` binary for login. */
export declare function codexLoginArgs(options: AddOptions): string[];
