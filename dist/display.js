const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const WHITE = "\x1b[37m";
const BG_GREEN = "\x1b[42m";
const BG_YELLOW = "\x1b[43m";
const BG_RED = "\x1b[41m";
const BG_GRAY = "\x1b[100m";
/** Get color based on usage percentage */
function usageColor(usedPercent) {
    if (usedPercent >= 90)
        return RED;
    if (usedPercent >= 70)
        return YELLOW;
    return GREEN;
}
function barBgColor(usedPercent) {
    if (usedPercent >= 90)
        return BG_RED;
    if (usedPercent >= 70)
        return BG_YELLOW;
    return BG_GREEN;
}
/** Render a usage bar */
function renderBar(usedPercent, width = 20) {
    const filled = Math.round((usedPercent / 100) * width);
    const empty = width - filled;
    const bg = barBgColor(usedPercent);
    return `${bg}${" ".repeat(filled)}${BG_GRAY}${" ".repeat(empty)}${RESET}`;
}
/** Collect all display rows for an account */
function collectRows(usage) {
    const rows = [];
    if (usage.primary) {
        const windowLabel = usage.primary.windowMinutes >= 60
            ? `${Math.round(usage.primary.windowMinutes / 60)}h limit`
            : `${usage.primary.windowMinutes}m limit`;
        rows.push({ label: windowLabel, usedPercent: usage.primary.usedPercent, resetsIn: usage.primary.resetsIn });
    }
    if (usage.secondary) {
        const windowLabel = usage.secondary.windowMinutes
            ? usage.secondary.windowMinutes >= 1440
                ? `${Math.round(usage.secondary.windowMinutes / 1440)}d limit`
                : `${Math.round(usage.secondary.windowMinutes / 60)}h limit`
            : "Weekly limit";
        rows.push({ label: windowLabel, usedPercent: usage.secondary.usedPercent, resetsIn: usage.secondary.resetsIn });
    }
    if (usage.additionalLimits?.length) {
        for (const limit of usage.additionalLimits) {
            if (limit.primary) {
                rows.push({ label: limit.name, usedPercent: limit.primary.usedPercent, resetsIn: limit.primary.resetsIn });
            }
            if (limit.secondary) {
                rows.push({ label: `${limit.name} (weekly)`, usedPercent: limit.secondary.usedPercent, resetsIn: limit.secondary.resetsIn });
            }
        }
    }
    return rows;
}
function formatDisplayName(email) {
    return email.startsWith("apikey:")
        ? `${email.slice(7)} ${DIM}(api key)${RESET}`
        : email;
}
function fmtUsd(n) {
    if (n === 0)
        return "$0";
    if (n < 0.01)
        return `$${n.toFixed(4)}`;
    if (n < 1)
        return `$${n.toFixed(3)}`;
    return `$${n.toFixed(2)}`;
}
function fmtTokens(n) {
    if (n === 0)
        return "0";
    if (n >= 1_000_000)
        return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000)
        return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
}
function fmtAge(iso) {
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 60_000)
        return `${Math.round(ms / 1000)}s ago`;
    if (ms < 3_600_000)
        return `${Math.round(ms / 60_000)}m ago`;
    if (ms < 86_400_000)
        return `${Math.round(ms / 3_600_000)}h ago`;
    return `${Math.round(ms / 86_400_000)}d ago`;
}
function totalTokens(d) {
    return d.inputTokens + d.cachedInputTokens + d.outputTokens;
}
function renderApiKeySpend(snapshot, labelWidth) {
    const scope = snapshot.projectId
        ? `proj ${snapshot.projectName ?? snapshot.projectId}`
        : "org-wide";
    console.log(`  ${DIM}${"scope".padEnd(labelWidth)}:${RESET} ${scope} ${DIM}via ${snapshot.adminKeyLabel}, ${fmtAge(snapshot.fetchedAt)}${RESET}`);
    const todayUsdStr = snapshot.todayCostEstimated
        ? `~${fmtUsd(snapshot.todayUsd)}`
        : fmtUsd(snapshot.todayUsd);
    const todayCostNote = snapshot.todayCostEstimated ? ` ${DIM}est${RESET}` : "";
    const today = `${todayUsdStr.padStart(8)}${todayCostNote} ${DIM}(${fmtTokens(snapshot.todayTokens)} tok)${RESET}`;
    const week = `${fmtUsd(snapshot.weekUsd).padStart(8)} ${DIM}(${fmtTokens(snapshot.weekTokens)} tok)${RESET}`;
    const month = `${fmtUsd(snapshot.monthUsd).padStart(8)} ${DIM}(${fmtTokens(snapshot.monthTokens)} tok)${RESET}`;
    console.log(`  ${DIM}${"today".padEnd(labelWidth)}:${RESET} ${today}`);
    console.log(`  ${DIM}${"7d".padEnd(labelWidth)}:${RESET} ${week}`);
    console.log(`  ${DIM}${"30d".padEnd(labelWidth)}:${RESET} ${month}`);
    if (snapshot.topModel && snapshot.topModel.tokens > 0) {
        console.log(`  ${DIM}${"top model".padEnd(labelWidth)}:${RESET} ${snapshot.topModel.model} ${DIM}(${fmtTokens(snapshot.topModel.tokens)} tok 30d)${RESET}`);
    }
}
/** Display a single account's usage */
function displayAccount(usage, globalLabelWidth, index) {
    const activeMarker = usage.isActive ? ` ${CYAN}(active)${RESET}` : "";
    const recommendedMarker = usage.gtoRecommended ? ` ${GREEN}[recommended]${RESET}` : "";
    const plan = usage.planType ? ` ${DIM}[${usage.planType}]${RESET}` : "";
    const prefix = index !== undefined ? `${DIM}${index})${RESET} ` : "";
    const displayName = formatDisplayName(usage.email);
    console.log(`${prefix}${BOLD}${WHITE}${displayName}${RESET}${plan}${activeMarker}${recommendedMarker}`);
    if (usage.error) {
        console.log(`  ${RED}Error: ${usage.error}${RESET}`);
        console.log();
        return;
    }
    const rows = collectRows(usage);
    if (usage.gtoReason) {
        console.log(`  ${DIM}${"pick".padEnd(globalLabelWidth)}:${RESET} ${usage.gtoReason}`);
    }
    for (const row of rows) {
        const padded = row.label.padEnd(globalLabelWidth);
        const pct = row.usedPercent;
        const remaining = (100 - pct).toFixed(1);
        const color = usageColor(pct);
        const resetStr = row.resetsIn ? ` ${DIM}resets in ${row.resetsIn}${RESET}` : "";
        console.log(`  ${DIM}${padded}:${RESET} ${renderBar(pct)} ${color}${remaining}% left${RESET}${resetStr}`);
    }
    if (usage.credits) {
        const padded = "Credits".padEnd(globalLabelWidth);
        if (usage.credits.unlimited) {
            console.log(`  ${DIM}${padded}:${RESET} ${GREEN}Unlimited${RESET}`);
        }
        else if (usage.credits.balance) {
            console.log(`  ${DIM}${padded}:${RESET} $${usage.credits.balance}`);
        }
    }
    if (usage.apiKeySpend) {
        renderApiKeySpend(usage.apiKeySpend, globalLabelWidth);
    }
    else if (usage.apiKeyHint) {
        console.log(`  ${DIM}${usage.apiKeyHint}${RESET}`);
    }
    console.log();
}
/** Display usage for all accounts */
export function displayAllUsage(usages) {
    if (usages.length === 0) {
        console.log(`${DIM}No accounts configured. Run 'agent-accounts add' to add one.${RESET}`);
        return;
    }
    // Find the max label width across ALL accounts so everything aligns
    let maxLabelWidth = 0;
    for (const usage of usages) {
        if (usage.error)
            continue;
        const rows = collectRows(usage);
        for (const row of rows) {
            maxLabelWidth = Math.max(maxLabelWidth, row.label.length);
        }
        if (usage.credits) {
            maxLabelWidth = Math.max(maxLabelWidth, "Credits".length);
        }
        if (usage.apiKeySpend) {
            maxLabelWidth = Math.max(maxLabelWidth, "top model".length);
        }
        if (usage.gtoReason) {
            maxLabelWidth = Math.max(maxLabelWidth, "pick".length);
        }
    }
    console.log();
    for (const usage of usages) {
        displayAccount(usage, maxLabelWidth);
    }
}
/** Display usage for all accounts with numbered indices for interactive selection */
export function displayAllUsageNumbered(usages) {
    if (usages.length === 0) {
        console.log(`${DIM}No accounts configured. Run 'aa add' to add one.${RESET}`);
        return;
    }
    let maxLabelWidth = 0;
    for (const usage of usages) {
        if (usage.error)
            continue;
        const rows = collectRows(usage);
        for (const row of rows) {
            maxLabelWidth = Math.max(maxLabelWidth, row.label.length);
        }
        if (usage.credits) {
            maxLabelWidth = Math.max(maxLabelWidth, "Credits".length);
        }
        if (usage.apiKeySpend) {
            maxLabelWidth = Math.max(maxLabelWidth, "top model".length);
        }
        if (usage.gtoReason) {
            maxLabelWidth = Math.max(maxLabelWidth, "pick".length);
        }
    }
    console.log();
    for (let i = 0; i < usages.length; i++) {
        displayAccount(usages[i], maxLabelWidth, i + 1);
    }
}
/** Display a simple account list */
export function displayAccountList(accounts) {
    if (accounts.length === 0) {
        console.log(`${DIM}No accounts configured. Run 'agent-accounts add' to add one.${RESET}`);
        return;
    }
    console.log();
    for (const acct of accounts) {
        const marker = acct.isActive ? `${CYAN} *${RESET}` : "";
        const date = new Date(acct.addedAt).toLocaleDateString();
        const displayName = formatDisplayName(acct.email);
        console.log(`  ${WHITE}${displayName}${RESET}${marker} ${DIM}(added ${date})${RESET}`);
    }
    console.log();
    console.log(`${DIM}* = currently active in ~/.codex/auth.json${RESET}`);
    console.log();
}
// --- Claude Code profile display ---
/** Format ISO reset time as relative duration */
function formatResetTime(resetsAt) {
    const remaining = new Date(resetsAt).getTime() - Date.now();
    if (remaining <= 0)
        return "now";
    const days = Math.floor(remaining / 86400000);
    const hours = Math.floor((remaining % 86400000) / 3600000);
    const mins = Math.floor((remaining % 3600000) / 60000);
    const parts = [];
    if (days > 0)
        parts.push(`${days}d`);
    if (hours > 0)
        parts.push(`${hours}h`);
    if (mins > 0 && days === 0)
        parts.push(`${mins}m`);
    return parts.length > 0 ? parts.join(" ") : "<1m";
}
/** Collect usage rows from Claude usage data */
function collectClaudeRows(p) {
    const rows = [];
    if (!p.usage)
        return rows;
    if (p.usage.five_hour?.utilization != null) {
        rows.push({
            label: "5h limit",
            usedPercent: p.usage.five_hour.utilization,
            resetsIn: p.usage.five_hour.resets_at ? formatResetTime(p.usage.five_hour.resets_at) : undefined,
        });
    }
    if (p.usage.seven_day?.utilization != null) {
        rows.push({
            label: "7d limit",
            usedPercent: p.usage.seven_day.utilization,
            resetsIn: p.usage.seven_day.resets_at ? formatResetTime(p.usage.seven_day.resets_at) : undefined,
        });
    }
    if (p.usage.seven_day_opus?.utilization != null) {
        rows.push({
            label: "Opus (weekly)",
            usedPercent: p.usage.seven_day_opus.utilization,
            resetsIn: p.usage.seven_day_opus.resets_at ? formatResetTime(p.usage.seven_day_opus.resets_at) : undefined,
        });
    }
    if (p.usage.seven_day_sonnet?.utilization != null) {
        rows.push({
            label: "Sonnet (weekly)",
            usedPercent: p.usage.seven_day_sonnet.utilization,
            resetsIn: p.usage.seven_day_sonnet.resets_at ? formatResetTime(p.usage.seven_day_sonnet.resets_at) : undefined,
        });
    }
    if (p.usage.extra_usage?.is_enabled && p.usage.extra_usage.utilization != null) {
        rows.push({
            label: "Extra usage",
            usedPercent: p.usage.extra_usage.utilization,
        });
    }
    return rows;
}
function displayClaudeProfile(p, globalLabelWidth, index) {
    const prefix = index !== undefined ? `${DIM}${index})${RESET} ` : "";
    const active = p.isActive ? ` ${CYAN}(active)${RESET}` : "";
    if (p.error) {
        console.log(`${prefix}${BOLD}${WHITE}${p.name}${RESET}${active}`);
        console.log(`  ${RED}Error: ${p.error}${RESET}`);
        console.log();
        return;
    }
    if (!p.auth || !p.auth.loggedIn) {
        console.log(`${prefix}${BOLD}${WHITE}${p.name}${RESET}${active}`);
        console.log(`  ${DIM}not logged in${RESET}`);
        console.log();
        return;
    }
    const plan = p.auth.subscriptionType ? ` ${DIM}[${p.auth.subscriptionType}]${RESET}` : "";
    const org = p.auth.orgName ? ` ${DIM}(${p.auth.orgName})${RESET}` : "";
    console.log(`${prefix}${BOLD}${WHITE}${p.name}${RESET}${plan}${active}`);
    const rows = collectClaudeRows(p);
    if (rows.length > 0) {
        for (const row of rows) {
            const padded = row.label.padEnd(globalLabelWidth);
            const pct = row.usedPercent;
            const remaining = (100 - pct).toFixed(1);
            const color = usageColor(pct);
            const resetStr = row.resetsIn ? ` ${DIM}resets in ${row.resetsIn}${RESET}` : "";
            console.log(`  ${DIM}${padded}:${RESET} ${renderBar(pct)} ${color}${remaining}% left${RESET}${resetStr}`);
        }
    }
    else {
        // No usage data — show email as fallback info
        console.log(`  ${DIM}${p.auth.email || "unknown"}${org}${RESET}`);
    }
    console.log();
}
/** Compute global label width across all Claude profiles */
function claudeGlobalLabelWidth(profiles) {
    let max = 0;
    for (const p of profiles) {
        for (const row of collectClaudeRows(p)) {
            max = Math.max(max, row.label.length);
        }
    }
    return max;
}
/** Display Claude profiles */
export function displayClaudeProfiles(profiles) {
    if (profiles.length === 0) {
        console.log(`${DIM}No Claude profiles. Run 'aa claude add' to create one.${RESET}`);
        return;
    }
    const labelWidth = claudeGlobalLabelWidth(profiles);
    console.log();
    for (const p of profiles)
        displayClaudeProfile(p, labelWidth);
}
/** Display Claude profiles with numbered indices for interactive selection */
export function displayClaudeProfilesNumbered(profiles) {
    if (profiles.length === 0) {
        console.log(`${DIM}No Claude profiles. Run 'aa claude add' to create one.${RESET}`);
        return;
    }
    const labelWidth = claudeGlobalLabelWidth(profiles);
    console.log();
    for (let i = 0; i < profiles.length; i++)
        displayClaudeProfile(profiles[i], labelWidth, i + 1);
}
// --- Grok Build profile display ---
function grokUsedPercent(profile) {
    const config = profile.usage?.config;
    if (!config)
        return null;
    if (typeof config.creditUsagePercent === "number")
        return config.creditUsagePercent;
    const limit = config.monthlyLimit?.val ?? 0;
    const used = config.used?.val ?? 0;
    return limit > 0 ? (used / limit) * 100 : null;
}
function grokPeriodLabel(profile) {
    const type = profile.usage?.config?.currentPeriod?.type?.toLowerCase() ?? "";
    if (type.includes("week"))
        return "Weekly limit";
    if (type.includes("month"))
        return "Monthly limit";
    return "Usage limit";
}
function displayGrokProfile(profile, labelWidth, index) {
    const prefix = index !== undefined ? `${DIM}${index})${RESET} ` : "";
    const active = profile.isActive ? ` ${CYAN}(active)${RESET}` : "";
    const plan = profile.usage?.subscriptionTier
        ? ` ${DIM}[${profile.usage.subscriptionTier}]${RESET}`
        : "";
    console.log(`${prefix}${BOLD}${WHITE}${profile.name}${RESET}${plan}${active}`);
    if (profile.error) {
        console.log(`  ${RED}Error: ${profile.error}${RESET}`);
        console.log();
        return;
    }
    if (!profile.auth) {
        console.log(`  ${DIM}not logged in${RESET}`);
        console.log();
        return;
    }
    const usedPercent = grokUsedPercent(profile);
    if (usedPercent !== null) {
        const label = grokPeriodLabel(profile).padEnd(labelWidth);
        const resetsAt = profile.usage?.config?.currentPeriod?.end
            ?? profile.usage?.config?.billingPeriodEnd;
        const resets = resetsAt ? ` ${DIM}resets in ${formatResetTime(resetsAt)}${RESET}` : "";
        const clamped = Math.max(0, Math.min(100, usedPercent));
        console.log(`  ${DIM}${label}:${RESET} ${renderBar(clamped)} ${usageColor(clamped)}${Math.max(0, 100 - usedPercent).toFixed(1)}% left${RESET}${resets}`);
    }
    const prepaid = profile.usage?.config?.prepaidBalance?.val;
    if (prepaid !== undefined && prepaid !== 0) {
        console.log(`  ${DIM}${"Prepaid credits".padEnd(labelWidth)}:${RESET} ${fmtUsd(prepaid / 100)}`);
    }
    const onDemandUsed = profile.usage?.config?.onDemandUsed?.val;
    const onDemandCap = profile.usage?.config?.onDemandCap?.val;
    if (onDemandUsed !== undefined || onDemandCap !== undefined) {
        const used = fmtUsd((onDemandUsed ?? 0) / 100);
        const cap = onDemandCap !== undefined ? ` / ${fmtUsd(onDemandCap / 100)}` : "";
        console.log(`  ${DIM}${"On-demand".padEnd(labelWidth)}:${RESET} ${used}${cap}`);
    }
    if (usedPercent === null && prepaid === undefined && onDemandUsed === undefined) {
        console.log(`  ${DIM}${profile.auth.email ?? profile.auth.user_id}${RESET}`);
    }
    console.log();
}
function grokLabelWidth(profiles) {
    let width = "Usage limit".length;
    for (const profile of profiles) {
        width = Math.max(width, grokPeriodLabel(profile).length);
        if (profile.usage?.config?.prepaidBalance)
            width = Math.max(width, "Prepaid credits".length);
        if (profile.usage?.config?.onDemandUsed || profile.usage?.config?.onDemandCap) {
            width = Math.max(width, "On-demand".length);
        }
    }
    return width;
}
export function displayGrokProfiles(profiles) {
    if (profiles.length === 0) {
        console.log(`${DIM}No Grok Build profiles. Run 'aa grok add' to create one.${RESET}`);
        return;
    }
    const width = grokLabelWidth(profiles);
    console.log();
    for (const profile of profiles)
        displayGrokProfile(profile, width);
}
export function displayGrokProfilesNumbered(profiles) {
    if (profiles.length === 0) {
        console.log(`${DIM}No Grok Build profiles. Run 'aa grok add' to create one.${RESET}`);
        return;
    }
    const width = grokLabelWidth(profiles);
    console.log();
    for (let i = 0; i < profiles.length; i++)
        displayGrokProfile(profiles[i], width, i + 1);
}
//# sourceMappingURL=display.js.map