import type { AddOptions } from "./add-options.js";
export interface LoginCommandResult {
    code: number;
}
export interface LoginSpawnOptions {
    env?: NodeJS.ProcessEnv;
}
export type LoginRunner = (command: string, args: string[], spawnOptions?: LoginSpawnOptions) => Promise<LoginCommandResult>;
export declare function runCodexLogin(options?: AddOptions, runner?: LoginRunner, spawnOptions?: LoginSpawnOptions): Promise<void>;
