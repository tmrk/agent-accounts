import type { CodexAuthFile } from "./types.js";
/** Always exchange the refresh token. Access JWTs can still look valid after server-side revoke. */
export declare function refreshTokens(auth: CodexAuthFile): Promise<CodexAuthFile>;
/** Refresh OAuth tokens if the access token is expired */
export declare function refreshIfExpired(auth: CodexAuthFile): Promise<{
    auth: CodexAuthFile;
    refreshed: boolean;
}>;
