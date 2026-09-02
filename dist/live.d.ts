export declare const DEFAULT_LIVE_INTERVAL_SECONDS = 30;
export declare const MIN_LIVE_INTERVAL_SECONDS = 5;
export declare const MAX_LIVE_INTERVAL_SECONDS: number;
export interface LiveOptions {
    enabled: boolean;
    intervalSeconds: number;
}
export interface ParsedLiveArgs {
    args: string[];
    options: LiveOptions;
}
/** Pull global live-view flags out of a command without disturbing other arguments. */
export declare function parseLiveArgs(args: string[]): ParsedLiveArgs;
/** Re-render a usage view until interrupted. */
export declare function runLive(render: () => Promise<void>, intervalSeconds: number): Promise<void>;
