import type { GrokAuth, GrokBillingResponse, GrokProfile } from "./types.js";
export declare function validateGrokProfileName(name: string): string | null;
export declare function getGrokInstancePath(name: string): string;
export declare function createGrokProfile(name: string): string;
export declare function createTempGrokInstance(): {
    path: string;
    dirName: string;
};
export declare function registerGrokProfile(name: string, dirName: string): void;
export declare function cleanupGrokInstance(dirName: string): void;
export declare function listGrokProfiles(): GrokProfile[];
export declare function findGrokProfile(name: string): GrokProfile | null;
export declare function removeGrokProfile(name: string): boolean;
export declare function getActiveGrokProfile(): string | null;
export declare function setActiveGrokProfile(name: string): void;
export declare function detectGrokCli(): string | null;
export declare function parseGrokAuthFile(value: unknown): GrokAuth | null;
export declare function readGrokAuth(instancePath: string): GrokAuth | null;
export declare class GrokHttpError extends Error {
    readonly status: number;
    constructor(status: number, message: string);
}
type FetchLike = typeof fetch;
/** Fetch the account-wide credit pool used by Grok Build's own /usage view. */
export declare function fetchGrokUsage(auth: GrokAuth, fetcher?: FetchLike, clientVersion?: string): Promise<GrokBillingResponse>;
/** Retry once after asking Grok itself to refresh its isolated OAuth session. */
export declare function fetchGrokUsageForPath(instancePath: string): Promise<{
    auth: GrokAuth;
    usage: GrokBillingResponse;
}>;
export {};
