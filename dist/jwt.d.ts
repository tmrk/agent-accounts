import type { IdTokenClaims } from "./types.js";
/** Decode a JWT payload without signature verification */
export declare function decodeJwt(token: string): IdTokenClaims;
/** Extract email from a Codex id_token JWT */
export declare function extractEmail(idToken: string): string | undefined;
/** Extract account_id from a Codex id_token JWT */
export declare function extractAccountId(idToken: string): string | undefined;
/** Check if a JWT access token is expired (with 60s grace) */
export declare function isTokenExpired(accessToken: string): boolean;
/** Extract plan type from id_token */
export declare function extractPlanType(idToken: string): string | undefined;
