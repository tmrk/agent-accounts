const COLOR_ENABLED = Boolean(process.stdout.isTTY) && process.env.NO_COLOR === undefined;
const ansi = (code) => COLOR_ENABLED ? code : "";
const RESET = ansi("\x1b[0m");
const BOLD = ansi("\x1b[1m");
const DIM = ansi("\x1b[2m");
const GREEN = ansi("\x1b[32m");
const YELLOW = ansi("\x1b[33m");
const RED = ansi("\x1b[31m");
const CYAN = ansi("\x1b[36m");
const WHITE = ansi("\x1b[37m");
const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;
const MIN_DASHBOARD_WIDTH = 40;
const MAX_DASHBOARD_WIDTH = 112;
const DEFAULT_DASHBOARD_WIDTH = 88;
function visibleLength(value) {
    return value.replace(ANSI_PATTERN, "").length;
}
function terminalWidth() {
    const envColumns = Number(process.env.COLUMNS);
    const columns = process.stdout.columns
        ?? (Number.isFinite(envColumns) && envColumns > 0 ? envColumns : DEFAULT_DASHBOARD_WIDTH);
    return Math.max(MIN_DASHBOARD_WIDTH, Math.min(MAX_DASHBOARD_WIDTH, columns));
}
function labelWidthCap() {
    return Math.max(8, Math.min(22, terminalWidth() - 28));
}
function plural(count, noun) {
    return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
function wrapText(value, width) {
    const lines = [];
    let remaining = value.trim();
    if (!remaining)
        return [""];
    while (remaining.length > width) {
        const candidate = remaining.slice(0, width + 1);
        const wordBreak = candidate.lastIndexOf(" ");
        const splitAt = wordBreak >= Math.floor(width / 2) ? wordBreak : width;
        lines.push(remaining.slice(0, splitAt).trimEnd());
        remaining = remaining.slice(splitAt).trimStart();
    }
    lines.push(remaining);
    return lines;
}
function fitContent(value, width) {
    const length = visibleLength(value);
    return length < width ? `${value}${" ".repeat(width - length)}` : value;
}
function printContent(value = "") {
    const width = terminalWidth() - 4;
    console.log(`│ ${fitContent(value, width)} │`);
}
function printSectionStart(title, count, noun) {
    const width = terminalWidth();
    const left = `╭─ ${title.toUpperCase()} `;
    const right = ` ${plural(count, noun)} ─╮`;
    const fill = "─".repeat(Math.max(1, width - left.length - right.length));
    console.log(`\n${BOLD}${left}${fill}${right}${RESET}`);
}
function printDivider() {
    console.log(`├${"─".repeat(terminalWidth() - 2)}┤`);
}
function printSectionEnd() {
    console.log(`╰${"─".repeat(terminalWidth() - 2)}╯`);
}
function statusColor(remainingPercent) {
    if (remainingPercent <= 10)
        return RED;
    if (remainingPercent <= 30)
        return YELLOW;
    return GREEN;
}
/** Render a quota bar whose filled portion represents quota remaining. */
function renderBar(usedPercent, width) {
    const remaining = Math.max(0, Math.min(100, 100 - usedPercent));
    const filled = Math.round((remaining / 100) * width);
    return `${statusColor(remaining)}${"█".repeat(filled)}${DIM}${"░".repeat(width - filled)}${RESET}`;
}
function printQuota(row, labelWidth) {
    const contentWidth = terminalWidth() - 4;
    const remaining = Math.max(0, 100 - row.usedPercent);
    let displayLabel = row.label;
    if (displayLabel.length > labelWidth) {
        printDetail("Limit", displayLabel, labelWidth);
        displayLabel = "Usage";
    }
    const prefix = `  ${displayLabel.padEnd(labelWidth)} `;
    const percent = `${remaining.toFixed(1).padStart(5)}% left`;
    let reset = row.resetsIn ? ` · ↻ ${row.resetsIn}` : "";
    let barWidth = contentWidth - prefix.length - percent.length - reset.length - 2;
    let wrappedReset;
    if (barWidth < 6 && reset) {
        wrappedReset = row.resetsIn;
        reset = "";
        barWidth = contentWidth - prefix.length - percent.length - 2;
    }
    barWidth = Math.max(3, barWidth);
    printContent(`${DIM}${prefix}${RESET}${renderBar(row.usedPercent, barWidth)}  ${statusColor(remaining)}${percent}${RESET}${DIM}${reset}${RESET}`);
    if (wrappedReset)
        printContent(`${DIM}${" ".repeat(prefix.length)}↻ resets in ${wrappedReset}${RESET}`);
}
function printDetail(label, value, labelWidth) {
    const contentWidth = terminalWidth() - 4;
    const prefix = `  ${label.padEnd(labelWidth)} `;
    const available = Math.max(1, contentWidth - prefix.length);
    const lines = wrapText(value, available);
    for (let i = 0; i < lines.length; i++) {
        const linePrefix = i === 0 ? prefix : " ".repeat(prefix.length);
        printContent(`${DIM}${linePrefix}${RESET}${lines[i]}`);
    }
}
function printNote(value) {
    const available = terminalWidth() - 8;
    for (const line of wrapText(value, available))
        printContent(`${DIM}  ${line}${RESET}`);
}
function printError(value) {
    const available = terminalWidth() - 10;
    const lines = wrapText(value, available);
    for (let i = 0; i < lines.length; i++) {
        printContent(i === 0 ? `  ${RED}Error${RESET}  ${lines[i]}` : `         ${lines[i]}`);
    }
}
function printAccountHeader(name, options) {
    const marker = options.index === undefined ? "●" : `${options.index}.`;
    const tags = [];
    if (options.plan)
        tags.push(options.plan.toUpperCase());
    if (options.recommended)
        tags.push("NEXT");
    if (options.active)
        tags.push("ACTIVE");
    const tagText = tags.length ? `  ${tags.join(" · ")}` : "";
    const styledTags = tagText
        .replace("NEXT", `${GREEN}NEXT${RESET}${BOLD}`)
        .replace("ACTIVE", `${CYAN}ACTIVE${RESET}${BOLD}`);
    const contentWidth = terminalWidth() - 4;
    if (marker.length + name.length + tagText.length + 1 <= contentWidth) {
        printContent(`${BOLD}${WHITE}${marker} ${name}${styledTags}${RESET}`);
        return;
    }
    const nameWidth = Math.max(8, contentWidth - marker.length - 1);
    const nameLines = wrapText(name, nameWidth);
    for (let i = 0; i < nameLines.length; i++) {
        const lineMarker = i === 0 ? `${marker} ` : " ".repeat(marker.length + 1);
        printContent(`${BOLD}${WHITE}${lineMarker}${nameLines[i]}${RESET}`);
    }
    if (tagText)
        printContent(`${BOLD}${styledTags}${RESET}`);
}
function formatDisplayName(email) {
    return email.startsWith("apikey:") ? `${email.slice(7)} (API key)` : email;
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
    const ms = Math.max(0, Date.now() - new Date(iso).getTime());
    if (ms < 60_000)
        return `${Math.round(ms / 1000)}s ago`;
    if (ms < 3_600_000)
        return `${Math.round(ms / 60_000)}m ago`;
    if (ms < 86_400_000)
        return `${Math.round(ms / 3_600_000)}h ago`;
    return `${Math.round(ms / 86_400_000)}d ago`;
}
function collectRows(usage) {
    const rows = [];
    if (usage.primary) {
        const label = usage.primary.windowMinutes >= 60
            ? `${Math.round(usage.primary.windowMinutes / 60)}h limit`
            : `${usage.primary.windowMinutes}m limit`;
        rows.push({ label, usedPercent: usage.primary.usedPercent, resetsIn: usage.primary.resetsIn });
    }
    if (usage.secondary) {
        const label = usage.secondary.windowMinutes
            ? usage.secondary.windowMinutes >= 1440
                ? `${Math.round(usage.secondary.windowMinutes / 1440)}d limit`
                : `${Math.round(usage.secondary.windowMinutes / 60)}h limit`
            : "Weekly limit";
        rows.push({ label, usedPercent: usage.secondary.usedPercent, resetsIn: usage.secondary.resetsIn });
    }
    for (const limit of usage.additionalLimits ?? []) {
        if (limit.primary)
            rows.push({ label: limit.name, usedPercent: limit.primary.usedPercent, resetsIn: limit.primary.resetsIn });
        if (limit.secondary)
            rows.push({ label: `${limit.name} (weekly)`, usedPercent: limit.secondary.usedPercent, resetsIn: limit.secondary.resetsIn });
    }
    return rows;
}
function renderApiKeySpend(snapshot, labelWidth) {
    const scope = snapshot.projectId ? `project ${snapshot.projectName ?? snapshot.projectId}` : "organization-wide";
    printDetail("Scope", `${scope} · via ${snapshot.adminKeyLabel} · ${fmtAge(snapshot.fetchedAt)}`, labelWidth);
    const today = `${snapshot.todayCostEstimated ? "~" : ""}${fmtUsd(snapshot.todayUsd)} · ${fmtTokens(snapshot.todayTokens)} tokens${snapshot.todayCostEstimated ? " · estimated" : ""}`;
    printDetail("Today", today, labelWidth);
    printDetail("7 days", `${fmtUsd(snapshot.weekUsd)} · ${fmtTokens(snapshot.weekTokens)} tokens`, labelWidth);
    printDetail("30 days", `${fmtUsd(snapshot.monthUsd)} · ${fmtTokens(snapshot.monthTokens)} tokens`, labelWidth);
    if (snapshot.topModel && snapshot.topModel.tokens > 0) {
        printDetail("Top model", `${snapshot.topModel.model} · ${fmtTokens(snapshot.topModel.tokens)} tokens / 30d`, labelWidth);
    }
}
function codexLabelWidth(usages) {
    let width = "Top model".length;
    for (const usage of usages) {
        for (const row of collectRows(usage))
            width = Math.max(width, row.label.length);
    }
    return Math.min(labelWidthCap(), width);
}
function displayAccount(usage, labelWidth, index) {
    printAccountHeader(formatDisplayName(usage.email), {
        index,
        plan: usage.planType,
        active: usage.isActive,
        recommended: usage.gtoRecommended,
    });
    if (usage.error) {
        printError(usage.error);
        return;
    }
    if (usage.gtoReason)
        printDetail("Next pick", usage.gtoReason, labelWidth);
    for (const row of collectRows(usage))
        printQuota(row, labelWidth);
    if (usage.credits) {
        printDetail("Credits", usage.credits.unlimited ? "Unlimited" : `$${usage.credits.balance ?? "0"}`, labelWidth);
    }
    if (usage.apiKeySpend)
        renderApiKeySpend(usage.apiKeySpend, labelWidth);
    else if (usage.apiKeyHint)
        printNote(usage.apiKeyHint);
}
function displayCodex(usages, numbered) {
    printSectionStart("Codex", usages.length, "account");
    if (usages.length === 0) {
        printNote("No accounts configured · run 'aa codex add'");
    }
    else {
        const labelWidth = codexLabelWidth(usages);
        for (let i = 0; i < usages.length; i++) {
            if (i > 0)
                printDivider();
            displayAccount(usages[i], labelWidth, numbered ? i + 1 : undefined);
        }
    }
    printSectionEnd();
}
export function displayAllUsage(usages) {
    displayCodex(usages, false);
}
export function displayAllUsageNumbered(usages) {
    displayCodex(usages, true);
}
export function displayAccountList(accounts) {
    printSectionStart("Codex accounts", accounts.length, "account");
    if (accounts.length === 0) {
        printNote("No accounts configured · run 'aa codex add'");
    }
    else {
        for (let i = 0; i < accounts.length; i++) {
            if (i > 0)
                printDivider();
            const account = accounts[i];
            printAccountHeader(formatDisplayName(account.email), { active: account.isActive });
            printDetail("Added", new Date(account.addedAt).toLocaleDateString(), "Added".length);
        }
    }
    printSectionEnd();
}
function formatResetTime(resetsAt) {
    const timestamp = typeof resetsAt === "number"
        ? (resetsAt < 100000000000 ? resetsAt * 1000 : resetsAt)
        : new Date(resetsAt).getTime();
    const remaining = timestamp - Date.now();
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
function collectClaudeRows(profile) {
    const rows = [];
    const usage = profile.usage;
    if (!usage)
        return rows;
    if (usage.five_hour?.utilization != null)
        rows.push({ label: "5h limit", usedPercent: usage.five_hour.utilization, resetsIn: usage.five_hour.resets_at ? formatResetTime(usage.five_hour.resets_at) : undefined });
    if (usage.seven_day?.utilization != null)
        rows.push({ label: "7d limit", usedPercent: usage.seven_day.utilization, resetsIn: usage.seven_day.resets_at ? formatResetTime(usage.seven_day.resets_at) : undefined });
    if (usage.seven_day_opus?.utilization != null)
        rows.push({ label: "Opus (weekly)", usedPercent: usage.seven_day_opus.utilization, resetsIn: usage.seven_day_opus.resets_at ? formatResetTime(usage.seven_day_opus.resets_at) : undefined });
    if (usage.seven_day_sonnet?.utilization != null)
        rows.push({ label: "Sonnet (weekly)", usedPercent: usage.seven_day_sonnet.utilization, resetsIn: usage.seven_day_sonnet.resets_at ? formatResetTime(usage.seven_day_sonnet.resets_at) : undefined });
    if (usage.extra_usage?.is_enabled && usage.extra_usage.utilization != null)
        rows.push({ label: "Extra usage", usedPercent: usage.extra_usage.utilization });
    const existingLabels = new Set(rows.map(row => row.label));
    for (const limit of usage.limits ?? []) {
        if (limit.percent == null)
            continue;
        const model = limit.scope?.model?.display_name;
        let label;
        if (limit.kind === "session")
            label = "5h limit";
        else if (limit.kind === "weekly_all")
            label = "7d limit";
        else if (limit.kind === "weekly_scoped" && model)
            label = `${model} (weekly)`;
        else
            label = limit.kind.replaceAll("_", " ");
        if (existingLabels.has(label))
            continue;
        rows.push({ label, usedPercent: limit.percent, resetsIn: limit.resets_at != null ? formatResetTime(limit.resets_at) : undefined });
        existingLabels.add(label);
    }
    return rows;
}
function claudeLabelWidth(profiles) {
    let width = "Identity".length;
    for (const profile of profiles) {
        for (const row of collectClaudeRows(profile))
            width = Math.max(width, row.label.length);
    }
    return Math.min(labelWidthCap(), width);
}
function displayClaudeProfile(profile, labelWidth, index) {
    printAccountHeader(profile.name, { index, plan: profile.auth?.subscriptionType, active: profile.isActive });
    if (profile.error) {
        printError(profile.error);
        return;
    }
    if (!profile.auth?.loggedIn) {
        printNote("Not logged in");
        return;
    }
    const identity = [profile.auth.email, profile.auth.orgName].filter(Boolean).join(" · ");
    if (identity && identity !== profile.name)
        printDetail("Identity", identity, labelWidth);
    const rows = collectClaudeRows(profile);
    for (const row of rows)
        printQuota(row, labelWidth);
    if (rows.length === 0 && !identity)
        printNote("Usage data unavailable");
    if (profile.usageError) {
        const cached = rows.length > 0 && profile.usageCachedAt ? ` · cached ${fmtAge(profile.usageCachedAt)}` : "";
        printNote(`${profile.usageError}${cached}`);
    }
}
function displayClaude(profiles, numbered) {
    printSectionStart("Claude Code", profiles.length, "profile");
    if (profiles.length === 0) {
        printNote("No profiles configured · run 'aa claude add'");
    }
    else {
        const labelWidth = claudeLabelWidth(profiles);
        for (let i = 0; i < profiles.length; i++) {
            if (i > 0)
                printDivider();
            displayClaudeProfile(profiles[i], labelWidth, numbered ? i + 1 : undefined);
        }
    }
    printSectionEnd();
}
export function displayClaudeProfiles(profiles) {
    displayClaude(profiles, false);
}
export function displayClaudeProfilesNumbered(profiles) {
    displayClaude(profiles, true);
}
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
function grokLabelWidth(profiles) {
    let width = "Prepaid credits".length;
    for (const profile of profiles)
        width = Math.max(width, grokPeriodLabel(profile).length);
    return Math.min(labelWidthCap(), width);
}
function displayGrokProfile(profile, labelWidth, index) {
    printAccountHeader(profile.name, { index, plan: profile.usage?.subscriptionTier, active: profile.isActive });
    if (profile.error) {
        printError(profile.error);
        return;
    }
    if (!profile.auth) {
        printNote("Not logged in");
        return;
    }
    const identity = [profile.auth.email, profile.auth.organization_name ?? profile.auth.team_name].filter(Boolean).join(" · ");
    if (identity && identity !== profile.name)
        printDetail("Identity", identity, labelWidth);
    const usedPercent = grokUsedPercent(profile);
    if (usedPercent !== null) {
        const resetsAt = profile.usage?.config?.currentPeriod?.end ?? profile.usage?.config?.billingPeriodEnd;
        printQuota({
            label: grokPeriodLabel(profile),
            usedPercent: Math.max(0, Math.min(100, usedPercent)),
            resetsIn: resetsAt ? formatResetTime(resetsAt) : undefined,
        }, labelWidth);
    }
    const prepaid = profile.usage?.config?.prepaidBalance?.val;
    if (prepaid !== undefined)
        printDetail("Prepaid credits", fmtUsd(prepaid / 100), labelWidth);
    const onDemandUsed = profile.usage?.config?.onDemandUsed?.val;
    const onDemandCap = profile.usage?.config?.onDemandCap?.val;
    if (onDemandUsed !== undefined || onDemandCap !== undefined) {
        const cap = onDemandCap !== undefined ? ` / ${fmtUsd(onDemandCap / 100)}` : "";
        printDetail("On-demand", `${fmtUsd((onDemandUsed ?? 0) / 100)}${cap}`, labelWidth);
    }
    if (usedPercent === null && prepaid === undefined && onDemandUsed === undefined && !identity)
        printNote("Usage data unavailable");
}
function displayGrok(profiles, numbered) {
    printSectionStart("Grok Build", profiles.length, "profile");
    if (profiles.length === 0) {
        printNote("No profiles configured · run 'aa grok add'");
    }
    else {
        const labelWidth = grokLabelWidth(profiles);
        for (let i = 0; i < profiles.length; i++) {
            if (i > 0)
                printDivider();
            displayGrokProfile(profiles[i], labelWidth, numbered ? i + 1 : undefined);
        }
    }
    printSectionEnd();
}
export function displayGrokProfiles(profiles) {
    displayGrok(profiles, false);
}
export function displayGrokProfilesNumbered(profiles) {
    displayGrok(profiles, true);
}
//# sourceMappingURL=display.js.map