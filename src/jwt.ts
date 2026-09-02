import type { IdTokenClaims } from "./types.js";

/** Decode a JWT payload without signature verification */
export function decodeJwt(token: string): IdTokenClaims {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid JWT format");
  }
  const payload = parts[1]!;
  // Handle base64url encoding
  const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const json = Buffer.from(padded, "base64").toString("utf-8");
  return JSON.parse(json);
}

/** Extract email from a Codex id_token JWT */
export function extractEmail(idToken: string): string | undefined {
  const claims = decodeJwt(idToken);
  // Try profile claim first (more reliable)
  const profileEmail = claims["https://api.openai.com/profile"]?.email;
  if (profileEmail) return profileEmail;
  // Fall back to top-level email
  return claims.email;
}

/** Extract account_id from a Codex id_token JWT */
export function extractAccountId(idToken: string): string | undefined {
  const claims = decodeJwt(idToken);
  return claims["https://api.openai.com/auth"]?.account_id;
}

/** Check if a JWT access token is expired (with 60s grace) */
export function isTokenExpired(accessToken: string): boolean {
  try {
    const claims = decodeJwt(accessToken);
    if (!claims.exp) return false;
    const now = Math.floor(Date.now() / 1000);
    return claims.exp - now < 60;
  } catch {
    return false;
  }
}

/** Extract plan type from id_token */
export function extractPlanType(idToken: string): string | undefined {
  try {
    const claims = decodeJwt(idToken);
    const auth = claims["https://api.openai.com/auth"] as Record<string, unknown> | undefined;
    if (!auth) return undefined;
    // Plan type can be in various fields
    for (const key of ["plan_type", "planType"]) {
      if (typeof auth[key] === "string") return auth[key] as string;
    }
    return undefined;
  } catch {
    return undefined;
  }
}
