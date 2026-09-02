/** Stored account on disk */
export interface StoredAccount {
  /** Email extracted from JWT id_token, or `apikey:<label>` for API key accounts */
  email: string;
  /** When this account was added */
  addedAt: string;
  /** The auth credentials */
  auth: CodexAuthFile;
  /** Optional OpenAI project_id this API-key account belongs to (apikey only) */
  projectId?: string;
  /** Cached project name for display (apikey only) */
  projectName?: string;
  /** Label of the admin key entry to use for usage queries (apikey only) */
  adminKeyLabel?: string;
}

/** Stored admin API key (`sk-admin-*`) for usage queries */
export interface AdminKeyEntry {
  label: string;
  key: string;
  /** Org id detected at add time, e.g. "org-abc..." */
  orgId?: string;
  /** Org name if available */
  orgName?: string;
  addedAt: string;
}

/** OpenAI project (from /v1/organization/projects) */
export interface OpenAIProject {
  id: string;
  name: string;
  status?: string;
}

/** Per-day rollup of cost + token usage */
export interface DailyUsage {
  /** ISO date (YYYY-MM-DD) for the bucket start in UTC */
  date: string;
  /** Cost in USD (may be estimated for today; see costEstimated) */
  costUsd: number;
  /** True if cost is estimated from token counts × price table (today only). */
  costEstimated?: boolean;
  /** Sum of input tokens (non-cached) */
  inputTokens: number;
  /** Sum of cached input tokens */
  cachedInputTokens: number;
  /** Sum of output tokens */
  outputTokens: number;
  /** Number of API requests */
  requests: number;
}

/** Aggregated spend snapshot displayed alongside an API-key account */
export interface ApiKeyUsageSnapshot {
  /** Which admin key this came from */
  adminKeyLabel: string;
  orgId?: string;
  /** Filter applied: project_id or null = whole org */
  projectId?: string;
  projectName?: string;
  /** When fetched */
  fetchedAt: string;
  todayUsd: number;
  /** True if today's $ is estimated from a model price table (cost API lags ~24h) */
  todayCostEstimated: boolean;
  weekUsd: number;
  monthUsd: number;
  todayTokens: number;
  weekTokens: number;
  monthTokens: number;
  /** Most-used model in the last 30d (by total tokens), if any */
  topModel?: { model: string; tokens: number };
  daily: DailyUsage[];
}

/** Format of ~/.codex/auth.json */
export interface CodexAuthFile {
  /** Present for OAuth/chatgpt accounts; omitted by codex for apikey mode */
  tokens?: {
    access_token: string;
    refresh_token: string;
    id_token: string;
    account_id?: string;
  };
  /** Present for OAuth/chatgpt accounts; omitted by codex for apikey mode */
  last_refresh?: string;
  auth_mode?: string;
  OPENAI_API_KEY?: string | null;
}

/** JWT claims from id_token */
export interface IdTokenClaims {
  email?: string;
  sub?: string;
  "https://api.openai.com/auth"?: {
    user_id?: string;
    account_id?: string;
  };
  "https://api.openai.com/profile"?: {
    email?: string;
  };
  exp?: number;
  iat?: number;
}

/** Rate limit window from /wham/usage */
export interface RateLimitWindow {
  used_percent: number;
  limit_window_seconds?: number;
  reset_after_seconds?: number;
  reset_at?: number;
}

/** Rate limit details from /wham/usage */
export interface RateLimitDetails {
  allowed: boolean;
  limit_reached: boolean;
  primary_window?: RateLimitWindow;
  secondary_window?: RateLimitWindow;
}

/** Additional rate limit entry */
export interface AdditionalRateLimit {
  metered_feature?: string;
  limit_name?: string;
  rate_limit: RateLimitDetails;
}

/** Credits info */
export interface CreditsInfo {
  has_credits: boolean;
  unlimited: boolean;
  balance?: string;
}

/** Full response from /wham/usage */
export interface UsageResponse {
  plan_type?: string;
  rate_limit: RateLimitDetails;
  credits?: CreditsInfo;
  additional_rate_limits?: AdditionalRateLimit[];
}

/** Formatted usage for display */
export interface AccountUsage {
  email: string;
  isActive: boolean;
  planType?: string;
  primary?: {
    usedPercent: number;
    windowMinutes: number;
    resetsIn?: string;
    resetAfterSeconds?: number;
  };
  secondary?: {
    usedPercent: number;
    windowMinutes?: number;
    resetsIn?: string;
    resetAfterSeconds?: number;
  };
  additionalLimits?: {
    name: string;
    primary?: { usedPercent: number; resetsIn?: string; resetAfterSeconds?: number };
    secondary?: { usedPercent: number; resetsIn?: string; resetAfterSeconds?: number };
  }[];
  credits?: {
    hasCredits: boolean;
    unlimited: boolean;
    balance?: string;
  };
  /** API-key accounts only: spend pulled via the linked admin key */
  apiKeySpend?: ApiKeyUsageSnapshot;
  /** API-key accounts only: human hint when no admin key is linked */
  apiKeyHint?: string;
  /** Interactive picker rank after expiry-aware account selection. */
  gtoRank?: number;
  /** True for the first account the expiry-aware picker would spend next. */
  gtoRecommended?: boolean;
  /** Short picker rationale for display. */
  gtoReason?: string;
  error?: string;
}

// --- Claude Code types ---

/** Claude Code profile metadata */
export interface ClaudeProfile {
  name: string;
  createdAt: string;
  lastUsed?: string;
  /** Instance directory name under ~/.agent-accounts/claude/ */
  dir: string;
}

/** Claude Code profiles file (~/.agent-accounts/claude.json) */
export interface ClaudeProfilesFile {
  active?: string;
  profiles: Record<string, ClaudeProfile>;
}

/** Claude auth status from `claude auth status` */
export interface ClaudeAuthStatus {
  loggedIn: boolean;
  authMethod?: string | null;
  apiProvider?: string | null;
  email?: string | null;
  orgId?: string | null;
  orgName?: string | null;
  subscriptionType?: string | null;
}

/** Credential info read from macOS Keychain or .credentials.json */
export interface ClaudeCredentialInfo {
  accessToken?: string;
  subscriptionType?: string;
  rateLimitTier?: string;
  expiresAt?: number;
}

/** A single rate limit window from /api/oauth/usage */
export interface ClaudeRateLimit {
  utilization: number | null;
  resets_at: string | null;
}

/** Extra usage info */
export interface ClaudeExtraUsage {
  is_enabled: boolean;
  monthly_limit: number | null;
  used_credits: number | null;
  utilization: number | null;
}

/** Full response from /api/oauth/usage */
export interface ClaudeUsageResponse {
  five_hour?: ClaudeRateLimit | null;
  seven_day?: ClaudeRateLimit | null;
  seven_day_opus?: ClaudeRateLimit | null;
  seven_day_sonnet?: ClaudeRateLimit | null;
  seven_day_oauth_apps?: ClaudeRateLimit | null;
  extra_usage?: ClaudeExtraUsage | null;
}

/** Claude profile info for display */
export interface ClaudeProfileInfo {
  name: string;
  isActive: boolean;
  createdAt: string;
  auth: ClaudeAuthStatus | null;
  credential?: ClaudeCredentialInfo | null;
  usage?: ClaudeUsageResponse | null;
  error?: string;
}

// --- Grok Build types ---

/** Grok Build profile metadata stored by agent-accounts. */
export interface GrokProfile {
  name: string;
  createdAt: string;
  lastUsed?: string;
  /** Instance directory name under ~/.agent-accounts/grok/. */
  dir: string;
}

export interface GrokProfilesFile {
  active?: string;
  profiles: Record<string, GrokProfile>;
}

/** One credential entry inside Grok Build's scoped auth.json map. */
export interface GrokAuth {
  key: string;
  auth_mode: "oidc" | "external" | "api_key" | "web_login" | string;
  create_time?: string;
  user_id: string;
  email?: string | null;
  first_name?: string | null;
  principal_type?: string | null;
  principal_id?: string | null;
  team_id?: string | null;
  team_name?: string | null;
  organization_id?: string | null;
  organization_name?: string | null;
  refresh_token?: string | null;
  expires_at?: string | null;
  oidc_issuer?: string | null;
  oidc_client_id?: string | null;
}

export type GrokAuthFile = Record<string, GrokAuth>;

export interface GrokCent {
  val?: number;
}

export interface GrokUsagePeriod {
  type?: string;
  start?: string;
  end?: string;
}

export interface GrokBillingConfig {
  creditUsagePercent?: number;
  currentPeriod?: GrokUsagePeriod;
  monthlyLimit?: GrokCent;
  used?: GrokCent;
  onDemandCap?: GrokCent;
  onDemandUsed?: GrokCent;
  prepaidBalance?: GrokCent;
  isUnifiedBillingUser?: boolean;
  billingPeriodStart?: string;
  billingPeriodEnd?: string;
}

export interface GrokBillingResponse {
  config?: GrokBillingConfig | null;
  subscriptionTier?: string | null;
}

export interface GrokUserInfo {
  userId?: string;
  email?: string | null;
  subscriptionTier?: string | null;
}

export interface GrokProfileInfo {
  name: string;
  isActive: boolean;
  createdAt: string;
  auth: GrokAuth | null;
  usage?: GrokBillingResponse | null;
  error?: string;
}
