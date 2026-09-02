import { isTokenExpired } from "./jwt.js";
const AUTH_ENDPOINT = "https://auth.openai.com/oauth/token";
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
/** Always exchange the refresh token. Access JWTs can still look valid after server-side revoke. */
export async function refreshTokens(auth) {
    if (!auth.tokens) {
        throw new Error("Cannot refresh an API-key account");
    }
    const res = await fetch(AUTH_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            client_id: CLIENT_ID,
            grant_type: "refresh_token",
            refresh_token: auth.tokens.refresh_token,
        }),
    });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Token refresh failed (${res.status}): ${body}`);
    }
    const data = (await res.json());
    if (!data.access_token || !data.refresh_token || !data.id_token) {
        throw new Error("Token refresh response missing required fields");
    }
    return {
        ...auth,
        tokens: {
            ...auth.tokens,
            access_token: data.access_token,
            refresh_token: data.refresh_token,
            id_token: data.id_token,
        },
        last_refresh: new Date().toISOString(),
    };
}
/** Refresh OAuth tokens if the access token is expired */
export async function refreshIfExpired(auth) {
    if (!auth.tokens) {
        // API-key accounts have no OAuth tokens to refresh
        return { auth, refreshed: false };
    }
    if (!isTokenExpired(auth.tokens.access_token)) {
        return { auth, refreshed: false };
    }
    return { auth: await refreshTokens(auth), refreshed: true };
}
//# sourceMappingURL=token-refresh.js.map