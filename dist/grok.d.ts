import { type SwitchOutcome } from "./live.js";
import type { GrokProfileInfo } from "./types.js";
interface AddArgs {
    name?: string;
    deviceAuth: boolean;
}
export declare function parseGrokAddArgs(args: string[]): AddArgs;
export declare function loadGrokProfiles(): Promise<GrokProfileInfo[]>;
export declare function grokStatus(): Promise<void>;
export declare function activateGrokProfile(name: string): SwitchOutcome;
export declare function grokMain(args: string[]): Promise<void>;
export {};
