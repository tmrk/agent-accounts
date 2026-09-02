const API_BASE = "https://api.openai.com";
/** Costs/usage endpoints can take 30-90s. Don't use the 30s default. */
const REQUEST_TIMEOUT_MS = 120_000;
/**
 * Per-1M-token list prices for cost estimation when today's daily cost
 * bucket is empty (OpenAI's costs API rolls up daily, after ~UTC midnight).
 * Order matters: the longest matching prefix wins. Update when prices change.
 */
const MODEL_PRICES = [
    { prefix: "gpt-5.1-codex", inUsdPerM: 1.25, outUsdPerM: 10 },
    { prefix: "gpt-5.1", inUsdPerM: 1.25, outUsdPerM: 10 },
    { prefix: "gpt-5-codex", inUsdPerM: 1.25, outUsdPerM: 10 },
    { prefix: "gpt-5-mini", inUsdPerM: 0.25, outUsdPerM: 2.0 },
    { prefix: "gpt-5-nano", inUsdPerM: 0.05, outUsdPerM: 0.40 },
    { prefix: "gpt-5", inUsdPerM: 1.25, outUsdPerM: 10 },
    { prefix: "gpt-4.1-mini", inUsdPerM: 0.40, outUsdPerM: 1.60 },
    { prefix: "gpt-4.1-nano", inUsdPerM: 0.10, outUsdPerM: 0.40 },
    { prefix: "gpt-4.1", inUsdPerM: 2.0, outUsdPerM: 8.0 },
    { prefix: "gpt-4o-mini", inUsdPerM: 0.15, outUsdPerM: 0.60 },
    { prefix: "gpt-4o", inUsdPerM: 2.50, outUsdPerM: 10.0 },
    { prefix: "gpt-4-turbo", inUsdPerM: 10, outUsdPerM: 30 },
    { prefix: "gpt-4", inUsdPerM: 30, outUsdPerM: 60 },
    { prefix: "o1-mini", inUsdPerM: 3, outUsdPerM: 12 },
    { prefix: "o1", inUsdPerM: 15, outUsdPerM: 60 },
    { prefix: "o3-mini", inUsdPerM: 1.10, outUsdPerM: 4.40 },
    { prefix: "o3", inUsdPerM: 10, outUsdPerM: 40 },
    { prefix: "o4-mini", inUsdPerM: 1.10, outUsdPerM: 4.40 },
];
/** Default cached-input discount when not specified (newer GPT-5 models charge 0.1x). */
const DEFAULT_CACHED_DISCOUNT = 0.1;
function priceFor(model) {
    const m = model.toLowerCase();
    for (const p of MODEL_PRICES) {
        if (m.startsWith(p.prefix)) {
            return { inUsdPerM: p.inUsdPerM, outUsdPerM: p.outUsdPerM, cachedDiscount: p.cachedDiscount ?? DEFAULT_CACHED_DISCOUNT };
        }
    }
    return undefined;
}
export function estimateCostUsd(model, inputTokens, cachedInputTokens, outputTokens) {
    const p = priceFor(model);
    if (!p)
        return undefined;
    const inputCost = (inputTokens / 1_000_000) * p.inUsdPerM;
    const cachedCost = (cachedInputTokens / 1_000_000) * p.inUsdPerM * p.cachedDiscount;
    const outputCost = (outputTokens / 1_000_000) * p.outUsdPerM;
    return inputCost + cachedCost + outputCost;
}
class OpenAIAdminError extends Error {
    status;
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}
async function fetchJsonOnce(adminKey, path, params) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
        if (Array.isArray(v)) {
            for (const item of v)
                qs.append(k, item);
        }
        else {
            qs.set(k, v);
        }
    }
    const url = `${API_BASE}${path}${qs.toString() ? `?${qs.toString()}` : ""}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const res = await fetch(url, {
            headers: {
                Authorization: `Bearer ${adminKey}`,
                Accept: "application/json",
            },
            signal: controller.signal,
        });
        if (!res.ok) {
            const text = await res.text().catch(() => "");
            const trimmed = text.length > 200 ? text.slice(0, 200) + "..." : text;
            throw new OpenAIAdminError(res.status, `OpenAI ${res.status} ${path}: ${trimmed || res.statusText}`);
        }
        return (await res.json());
    }
    catch (err) {
        if (err.name === "AbortError") {
            throw new OpenAIAdminError(0, `OpenAI ${path} timed out after ${Math.round(REQUEST_TIMEOUT_MS / 1000)}s`);
        }
        throw err;
    }
    finally {
        clearTimeout(timeout);
    }
}
/**
 * Fetch with retry on transient errors (5xx, 0/timeout). Exponential backoff.
 * The /v1/organization/usage/* and /v1/organization/costs endpoints regularly
 * 504 from Cloudflare under load.
 */
async function fetchJson(adminKey, path, params = {}) {
    const maxAttempts = 4;
    let lastErr;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fetchJsonOnce(adminKey, path, params);
        }
        catch (err) {
            lastErr = err;
            const status = err instanceof OpenAIAdminError ? err.status : -1;
            const transient = status === 0 || status >= 500;
            if (!transient || attempt === maxAttempts)
                throw err;
            const backoff = Math.min(8000, 1000 * 2 ** (attempt - 1));
            await new Promise(r => setTimeout(r, backoff));
        }
    }
    throw lastErr;
}
/** Validate an admin key by hitting a cheap endpoint. Returns the org id if found. */
export async function validateAdminKey(adminKey) {
    try {
        // Use projects?limit=1 — works with `api.management.read`. If the key only
        // has `api.usage.read`, fall back to a small costs query.
        try {
            await fetchJson(adminKey, "/v1/organization/projects", { limit: "1" });
            return { ok: true };
        }
        catch (err) {
            if (err instanceof OpenAIAdminError && err.status === 403) {
                // No management.read — try a usage probe instead
                const start = Math.floor(Date.now() / 1000) - 86_400;
                await fetchJson(adminKey, "/v1/organization/costs", {
                    start_time: String(start),
                    bucket_width: "1d",
                    limit: "1",
                });
                return { ok: true };
            }
            throw err;
        }
    }
    catch (err) {
        return { ok: false, error: err.message };
    }
}
/** List all projects in the org. Requires `api.management.read`. */
export async function listProjects(adminKey) {
    const out = [];
    let after;
    for (let page = 0; page < 20; page++) {
        const params = { limit: "100" };
        if (after)
            params.after = after;
        const res = await fetchJson(adminKey, "/v1/organization/projects", params);
        for (const p of res.data ?? [])
            out.push({ id: p.id, name: p.name, status: p.status });
        if (!res.has_more || !res.last_id)
            break;
        after = res.last_id;
    }
    return out;
}
/**
 * Pull per-day cost + token rollups for the trailing N days, plus the top model.
 *
 * Three OpenAI calls fire in parallel: (1) daily costs, (2) daily usage by model,
 * (3) today's hourly usage by model. Today's daily bucket is empty until ~UTC
 * midnight (OpenAI's aggregation lag), so we splice the hourly values in and
 * estimate today's cost from a per-model price table.
 */
export async function fetchUsageRollup(adminKey, days, projectId) {
    const startTime = Math.floor(Date.now() / 1000) - days * 86_400;
    const limit = String(Math.min(days, 30));
    const costsParams = {
        start_time: String(startTime),
        bucket_width: "1d",
        limit,
    };
    const usageParams = {
        start_time: String(startTime),
        bucket_width: "1d",
        limit,
        "group_by[]": ["model"],
    };
    if (projectId) {
        costsParams["project_ids[]"] = [projectId];
        usageParams["project_ids[]"] = [projectId];
    }
    // Run all three queries concurrently. Retry-with-backoff in fetchJson
    // handles transient 504s.
    const [costsRes, usageRes, todayResult] = await Promise.all([
        fetchJson(adminKey, "/v1/organization/costs", costsParams),
        fetchJson(adminKey, "/v1/organization/usage/completions", usageParams),
        fetchTodayHourly(adminKey, projectId).catch(() => null),
    ]);
    const byDate = new Map();
    const ensure = (epochSeconds, iso) => {
        const d = iso ? iso.slice(0, 10) : new Date(epochSeconds * 1000).toISOString().slice(0, 10);
        let row = byDate.get(d);
        if (!row) {
            row = { date: d, costUsd: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, requests: 0 };
            byDate.set(d, row);
        }
        return row;
    };
    for (const bucket of costsRes.data ?? []) {
        const row = ensure(bucket.start_time, bucket.start_time_iso);
        for (const r of bucket.results ?? []) {
            if (r.amount?.value != null)
                row.costUsd += Number(r.amount.value) || 0;
        }
    }
    // Track per-model tokens for top-model computation, summed from the daily
    // usage response (which is already grouped by model).
    const tokensByModel = new Map();
    for (const bucket of usageRes.data ?? []) {
        const row = ensure(bucket.start_time, bucket.start_time_iso);
        for (const r of bucket.results ?? []) {
            const inT = r.input_tokens ?? 0;
            const cachedT = r.input_cached_tokens ?? 0;
            const outT = r.output_tokens ?? 0;
            row.inputTokens += inT;
            row.cachedInputTokens += cachedT;
            row.outputTokens += outT;
            row.requests += r.num_model_requests ?? 0;
            const model = r.model ?? "(unknown)";
            tokensByModel.set(model, (tokensByModel.get(model) ?? 0) + inT + cachedT + outT);
        }
    }
    // Splice in today's hourly numbers (already includes per-model breakdown
    // from fetchTodayHourly). Today's daily bucket usually returns 0 tokens AND
    // 0 cost; we replace tokens (accurate) and estimate cost.
    if (todayResult) {
        const row = byDate.get(todayResult.date) ?? {
            date: todayResult.date,
            costUsd: 0,
            inputTokens: 0,
            cachedInputTokens: 0,
            outputTokens: 0,
            requests: 0,
        };
        row.inputTokens = todayResult.inputTokens;
        row.cachedInputTokens = todayResult.cachedInputTokens;
        row.outputTokens = todayResult.outputTokens;
        row.requests = todayResult.requests;
        if (row.costUsd === 0 && todayResult.estimatedCostUsd != null) {
            row.costUsd = todayResult.estimatedCostUsd;
            row.costEstimated = true;
        }
        byDate.set(todayResult.date, row);
        // Roll today's per-model tokens into the top-model tally too.
        for (const [model, tokens] of todayResult.tokensByModel) {
            tokensByModel.set(model, (tokensByModel.get(model) ?? 0) + tokens);
        }
    }
    let topModel;
    for (const [model, tokens] of tokensByModel) {
        if (!topModel || tokens > topModel.tokens)
            topModel = { model, tokens };
    }
    const daily = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
    return { daily, topModel };
}
/** @deprecated Kept as a thin wrapper for back-compat with older callers. */
export async function fetchDailyUsage(adminKey, days, projectId) {
    const { daily } = await fetchUsageRollup(adminKey, days, projectId);
    return daily;
}
/**
 * Fetch today's usage so far, broken by hour and grouped by model. Today's
 * daily bucket lags by ~24h on OpenAI's side, but hourly buckets update
 * within minutes. Estimates cost from a per-model price table.
 */
export async function fetchTodayHourly(adminKey, projectId) {
    const now = new Date();
    const utcMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const start = Math.floor(utcMidnight / 1000);
    const params = {
        start_time: String(start),
        bucket_width: "1h",
        limit: "24",
        "group_by[]": ["model"],
    };
    if (projectId)
        params["project_ids[]"] = [projectId];
    const res = await fetchJson(adminKey, "/v1/organization/usage/completions", params);
    let inputTokens = 0;
    let cachedInputTokens = 0;
    let outputTokens = 0;
    let requests = 0;
    let estCost = 0;
    let unknownTokens = 0;
    let totalTokens = 0;
    const tokensByModel = new Map();
    for (const bucket of res.data ?? []) {
        for (const r of bucket.results ?? []) {
            const inT = r.input_tokens ?? 0;
            const cachedT = r.input_cached_tokens ?? 0;
            const outT = r.output_tokens ?? 0;
            const reqs = r.num_model_requests ?? 0;
            const model = r.model ?? "(unknown)";
            inputTokens += inT;
            cachedInputTokens += cachedT;
            outputTokens += outT;
            requests += reqs;
            const tok = inT + cachedT + outT;
            totalTokens += tok;
            tokensByModel.set(model, (tokensByModel.get(model) ?? 0) + tok);
            const c = estimateCostUsd(model, inT, cachedT, outT);
            if (c != null) {
                estCost += c;
            }
            else {
                unknownTokens += tok;
            }
        }
    }
    if (requests === 0 && inputTokens === 0 && outputTokens === 0)
        return null;
    return {
        date: new Date(utcMidnight).toISOString().slice(0, 10),
        inputTokens,
        cachedInputTokens,
        outputTokens,
        requests,
        estimatedCostUsd: estCost,
        estimateComplete: totalTokens === 0 ? true : unknownTokens === 0,
        tokensByModel,
    };
}
//# sourceMappingURL=openai-admin.js.map