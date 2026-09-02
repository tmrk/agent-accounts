export interface SwitchOptions {
    restartCodexGui: boolean;
}
export interface ParsedSwitchArgs {
    identifier?: string;
    options: SwitchOptions;
}
export declare function parseSwitchArgs(args: string[], defaults?: SwitchOptions): ParsedSwitchArgs;
