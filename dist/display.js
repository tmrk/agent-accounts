import { dashboardWidth, padVisible, truncateVisible, visibleLength, } from "./term.js";
function detectColor() {
    if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== "0")
        return true;
    if (process.env.NO_COLOR !== undefined || process.env.FORCE_COLOR === "0")
        return false;
    return Boolean(process.stdout.isTTY);
}
const COLOR_ENABLED = detectColor();
const ansi = (code) => COLOR_ENABLED ? code : "";
const RESET = ansi("\x1b[0m");
const BOLD = ansi("\x1b[1m");
const DIM = ansi("\x1b[2m");
const GREEN = ansi("\x1b[32m");
const YELLOW = ansi("\x1b[33m");
const RED = ansi("\x1b[31m");
const CYAN = ansi("\x1b[36m");
const WHITE = ansi("\x1b[37m");
const PERCENT_FIELD = 11;
const LABEL_GUTTER = 3;
const BAR_GAP = 2;
const RESET_GAP = 2;
function resolveWidth(options) {
    return options?.width ?? dashboardWidth();
}
function labelWidthCap(width) {
    return Math.max(8, Math.min(22, width - 28));
}
function plural(count, noun) {
    return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
function wrapText(value, width) {
    const lines = [];
    let remaining = value.trim();
    if (!remaining)
        return [""];
    if (width <= 0)
        return ["…"];
    while (remaining.length > width) {
        const candidate = remaining.slice(0, width + 1);
        const wordBreak = candidate.lastIndexOf(" ");
        const splitAt = wordBreak >= Math.floor(width / 2) ? wordBreak : width;
        lines.push(remaining.slice(0, splitAt).trimEnd());
        remaining = remaining.slice(splitAt).trimStart();
    }
    if (remaining)
        lines.push(remaining);
    return lines.length ? lines : [""];
}
class Frame {
    width;
    lines = [];
    constructor(width) {
        this.width = Math.max(8, width);
    }
    push(line = "") {
        this.lines.push(line);
    }
    content(value = "") {
        const inner = this.width - 4;
        this.push(`│ ${padVisible(value, inner)} │`);
    }
    sectionStart(title, count, noun, tight) {
        if (!tight)
            this.push("");
        const left = `╭─ ${title.toUpperCase()} `;
        const right = ` ${plural(count, noun)} ─╮`;
        const fill = "─".repeat(Math.max(1, this.width - visibleLength(left) - visibleLength(right)));
        this.push(`${BOLD}${padVisible(`${left}${fill}${right}`, this.width)}${RESET}`);
    }
    divider() {
        this.push(`├${"─".repeat(Math.max(1, this.width - 2))}┤`);
    }
    sectionEnd() {
        this.push(`╰${"─".repeat(Math.max(1, this.width - 2))}╯`);
    }
}
function statusColor(remainingPercent) {
    if (remainingPercent <= 10)
        return RED;
    if (remainingPercent <= 30)
        return YELLOW;
    return GREEN;
}
/**
 * Render a quota bar whose filled portion represents quota remaining.
 * Fill and empty use the same glyph so every bar has the same visual width;
 * without color the empty cells fall back to a lighter shade.
 */
function renderBar(usedPercent, width) {
    const remaining = Math.max(0, Math.min(100, 100 - usedPercent));
    const filled = Math.round((remaining / 100) * Math.max(0, width));
    const empty = Math.max(0, width - filled);
    const head = "█".repeat(filled);
    const tail = (COLOR_ENABLED ? "█" : "░").repeat(empty);
    if (!COLOR_ENABLED)
        return `${head}${tail}`;
    return `${statusColor(remaining)}${head}${RESET}${DIM}${tail}${RESET}`;
}
function resetLabel(resetsIn) {
    return resetsIn ? `↻ ${resetsIn}` : "";
}
function fitLabel(label, width) {
    return visibleLength(label) <= width ? label.padEnd(width) : truncateVisible(label, width);
}
function quotaBarWidth(contentWidth, labelWidth, resetWidth) {
    const resetSpace = resetWidth > 0 ? RESET_GAP + resetWidth : 0;
    return contentWidth - LABEL_GUTTER - labelWidth - BAR_GAP - PERCENT_FIELD - resetSpace;
}
function measureLayout(labels, resets, width) {
    let labelWidth = 8;
    for (const label of labels)
        labelWidth = Math.max(labelWidth, visibleLength(label));
    labelWidth = Math.min(labelWidthCap(width), labelWidth);
    let resetWidth = 0;
    for (const reset of resets)
        resetWidth = Math.max(resetWidth, visibleLength(resetLabel(reset)));
    const contentWidth = Math.max(8, width - 4);
    if (quotaBarWidth(contentWidth, labelWidth, resetWidth) < 4)
        resetWidth = 0;
    return { labelWidth, resetWidth };
}
function printQuota(frame, row, layout) {
    const contentWidth = frame.width - 4;
    const remaining = Math.max(0, 100 - row.usedPercent);
    const displayLabel = visibleLength(row.label) > layout.labelWidth ? "Usage" : row.label;
    if (visibleLength(row.label) > layout.labelWidth)
        printDetail(frame, "Limit", row.label, layout);
    const prefix = `  ${fitLabel(displayLabel, layout.labelWidth)} `;
    const percent = `${remaining.toFixed(1).padStart(5)}% left`;
    const reset = layout.resetWidth > 0
        ? `${" ".repeat(RESET_GAP)}${padVisible(resetLabel(row.resetsIn), layout.resetWidth)}`
        : "";
    const barWidth = Math.max(3, contentWidth - visibleLength(prefix) - BAR_GAP - visibleLength(percent) - visibleLength(reset));
    frame.content(`${DIM}${prefix}${RESET}${renderBar(row.usedPercent, barWidth)}${" ".repeat(BAR_GAP)}${statusColor(remaining)}${percent}${RESET}${DIM}${reset}${RESET}`);
    if (layout.resetWidth === 0 && row.resetsIn) {
        printDetail(frame, "", `↻ resets in ${row.resetsIn}`, layout);
    }
}
function printDetail(frame, label, value, layout) {
    const labelWidth = typeof layout === "number" ? layout : layout.labelWidth;
    const contentWidth = frame.width - 4;
    const prefix = `  ${fitLabel(label, labelWidth)} `;
    const available = Math.max(1, contentWidth - prefix.length);
    const lines = wrapText(value, available);
    for (let i = 0; i < lines.length; i++) {
        const linePrefix = i === 0 ? prefix : " ".repeat(prefix.length);
        frame.content(`${DIM}${linePrefix}${RESET}${lines[i]}`);
    }
}
function printNote(frame, value) {
    const available = Math.max(1, frame.width - 8);
    for (const line of wrapText(value, available))
        frame.content(`${DIM}  ${line}${RESET}`);
}
function printError(frame, value) {
    const available = Math.max(1, frame.width - 10);
    const lines = wrapText(value, available);
    for (let i = 0; i < lines.length; i++) {
        frame.content(i === 0 ? `  ${RED}Error${RESET}  ${lines[i]}` : `         ${lines[i]}`);
    }
}
function printAccountHeader(frame, name, options) {
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
    const contentWidth = frame.width - 4;
    if (visibleLength(`${marker} ${name}${tagText}`) <= contentWidth) {
        frame.content(`${BOLD}${WHITE}${marker} ${name}${styledTags}${RESET}`);
        return;
    }
    const nameWidth = Math.max(8, contentWidth - marker.length - 1);
    const nameLines = wrapText(name, nameWidth);
    for (let i = 0; i < nameLines.length; i++) {
        const lineMarker = i === 0 ? `${marker} ` : " ".repeat(marker.length + 1);
        frame.content(`${BOLD}${WHITE}${lineMarker}${nameLines[i]}${RESET}`);
    }
    if (tagText)
        frame.content(`${BOLD}${truncateVisible(styledTags, contentWidth)}${RESET}`);
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
function renderApiKeySpend(frame, snapshot, layout) {
    const scope = snapshot.projectId ? `project ${snapshot.projectName ?? snapshot.projectId}` : "organization-wide";
    printDetail(frame, "Scope", `${scope} · via ${snapshot.adminKeyLabel} · ${fmtAge(snapshot.fetchedAt)}`, layout);
    const today = `${snapshot.todayCostEstimated ? "~" : ""}${fmtUsd(snapshot.todayUsd)} · ${fmtTokens(snapshot.todayTokens)} tokens${snapshot.todayCostEstimated ? " · estimated" : ""}`;
    printDetail(frame, "Today", today, layout);
    printDetail(frame, "7 days", `${fmtUsd(snapshot.weekUsd)} · ${fmtTokens(snapshot.weekTokens)} tokens`, layout);
    printDetail(frame, "30 days", `${fmtUsd(snapshot.monthUsd)} · ${fmtTokens(snapshot.monthTokens)} tokens`, layout);
    if (snapshot.topModel && snapshot.topModel.tokens > 0) {
        printDetail(frame, "Top model", `${snapshot.topModel.model} · ${fmtTokens(snapshot.topModel.tokens)} tokens / 30d`, layout);
    }
}
function collectCodexLayout(usages) {
    const labels = ["Top model", "Next pick", "Credits", "Scope", "Today", "7 days", "30 days"];
    const resets = [];
    for (const usage of usages) {
        for (const row of collectRows(usage)) {
            labels.push(row.label);
            resets.push(row.resetsIn);
        }
    }
    return { labels, resets };
}
function displayAccount(frame, usage, layout, index) {
    printAccountHeader(frame, formatDisplayName(usage.email), {
        index,
        plan: usage.planType,
        active: usage.isActive,
        recommended: usage.gtoRecommended,
    });
    if (usage.error) {
        printError(frame, usage.error);
        return;
    }
    if (usage.gtoReason)
        printDetail(frame, "Next pick", usage.gtoReason, layout);
    for (const row of collectRows(usage))
        printQuota(frame, row, layout);
    if (usage.credits) {
        printDetail(frame, "Credits", usage.credits.unlimited ? "Unlimited" : `$${usage.credits.balance ?? "0"}`, layout);
    }
    if (usage.apiKeySpend)
        renderApiKeySpend(frame, usage.apiKeySpend, layout);
    else if (usage.apiKeyHint)
        printNote(frame, usage.apiKeyHint);
}
function renderCodex(usages, options) {
    const width = resolveWidth(options);
    const frame = new Frame(width);
    const numbered = options.numbered ?? false;
    const startIndex = options.startIndex ?? 1;
    frame.sectionStart("Codex", usages.length, "account", options.tight ?? false);
    if (usages.length === 0) {
        printNote(frame, "No accounts configured · run 'aacc codex add'");
    }
    else {
        const measured = collectCodexLayout(usages);
        const layout = options.labelWidth !== undefined && options.resetWidth !== undefined
            ? { labelWidth: options.labelWidth, resetWidth: options.resetWidth }
            : measureLayout(measured.labels, measured.resets, width);
        for (let i = 0; i < usages.length; i++) {
            if (i > 0)
                frame.divider();
            displayAccount(frame, usages[i], layout, numbered ? startIndex + i : undefined);
        }
    }
    frame.sectionEnd();
    return frame.lines;
}
export function renderCodexUsage(usages, options = {}) {
    return renderCodex(usages, options);
}
export function displayAllUsage(usages) {
    writeLines(renderCodex(usages, { numbered: false }));
}
export function displayAllUsageNumbered(usages) {
    writeLines(renderCodex(usages, { numbered: true }));
}
export function renderAccountList(accounts, options = {}) {
    const frame = new Frame(resolveWidth(options));
    frame.sectionStart("Codex accounts", accounts.length, "account", options.tight ?? false);
    if (accounts.length === 0) {
        printNote(frame, "No accounts configured · run 'aacc codex add'");
    }
    else {
        for (let i = 0; i < accounts.length; i++) {
            if (i > 0)
                frame.divider();
            const account = accounts[i];
            printAccountHeader(frame, formatDisplayName(account.email), { active: account.isActive });
            printDetail(frame, "Added", new Date(account.addedAt).toLocaleDateString(), "Added".length);
        }
    }
    frame.sectionEnd();
    return frame.lines;
}
export function displayAccountList(accounts) {
    writeLines(renderAccountList(accounts));
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
function collectClaudeLayout(profiles) {
    const labels = ["Identity"];
    const resets = [];
    for (const profile of profiles) {
        for (const row of collectClaudeRows(profile)) {
            labels.push(row.label);
            resets.push(row.resetsIn);
        }
    }
    return { labels, resets };
}
function displayClaudeProfile(frame, profile, layout, index) {
    printAccountHeader(frame, profile.name, { index, plan: profile.auth?.subscriptionType, active: profile.isActive });
    if (profile.error) {
        printError(frame, profile.error);
        return;
    }
    if (!profile.auth?.loggedIn) {
        printNote(frame, "Not logged in");
        return;
    }
    const identity = [profile.auth.email, profile.auth.orgName].filter(Boolean).join(" · ");
    if (identity && identity !== profile.name)
        printDetail(frame, "Identity", identity, layout);
    const rows = collectClaudeRows(profile);
    for (const row of rows)
        printQuota(frame, row, layout);
    if (rows.length === 0 && !identity)
        printNote(frame, "Usage data unavailable");
    if (profile.usageError) {
        const cached = rows.length > 0 && profile.usageCachedAt ? ` · cached ${fmtAge(profile.usageCachedAt)}` : "";
        printNote(frame, `${profile.usageError}${cached}`);
    }
}
function renderClaude(profiles, options) {
    const width = resolveWidth(options);
    const frame = new Frame(width);
    const numbered = options.numbered ?? false;
    const startIndex = options.startIndex ?? 1;
    frame.sectionStart("Claude Code", profiles.length, "profile", options.tight ?? false);
    if (profiles.length === 0) {
        printNote(frame, "No profiles configured · run 'aacc claude add'");
    }
    else {
        const measured = collectClaudeLayout(profiles);
        const layout = options.labelWidth !== undefined && options.resetWidth !== undefined
            ? { labelWidth: options.labelWidth, resetWidth: options.resetWidth }
            : measureLayout(measured.labels, measured.resets, width);
        for (let i = 0; i < profiles.length; i++) {
            if (i > 0)
                frame.divider();
            displayClaudeProfile(frame, profiles[i], layout, numbered ? startIndex + i : undefined);
        }
    }
    frame.sectionEnd();
    return frame.lines;
}
export function renderClaudeProfiles(profiles, options = {}) {
    return renderClaude(profiles, options);
}
export function displayClaudeProfiles(profiles) {
    writeLines(renderClaude(profiles, { numbered: false }));
}
export function displayClaudeProfilesNumbered(profiles) {
    writeLines(renderClaude(profiles, { numbered: true }));
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
function grokQuotaRow(profile) {
    const usedPercent = grokUsedPercent(profile);
    if (usedPercent === null)
        return undefined;
    const resetsAt = profile.usage?.config?.currentPeriod?.end ?? profile.usage?.config?.billingPeriodEnd;
    return {
        label: grokPeriodLabel(profile),
        usedPercent: Math.max(0, Math.min(100, usedPercent)),
        resetsIn: resetsAt ? formatResetTime(resetsAt) : undefined,
    };
}
function collectGrokLayout(profiles) {
    const labels = ["Identity", "Prepaid credits", "On-demand"];
    const resets = [];
    for (const profile of profiles) {
        const row = grokQuotaRow(profile);
        if (!row)
            continue;
        labels.push(row.label);
        resets.push(row.resetsIn);
    }
    return { labels, resets };
}
function displayGrokProfile(frame, profile, layout, index) {
    printAccountHeader(frame, profile.name, { index, plan: profile.usage?.subscriptionTier, active: profile.isActive });
    if (profile.error) {
        printError(frame, profile.error);
        return;
    }
    if (!profile.auth) {
        printNote(frame, "Not logged in");
        return;
    }
    const identity = [profile.auth.email, profile.auth.organization_name ?? profile.auth.team_name].filter(Boolean).join(" · ");
    if (identity && identity !== profile.name)
        printDetail(frame, "Identity", identity, layout);
    const quota = grokQuotaRow(profile);
    if (quota)
        printQuota(frame, quota, layout);
    const prepaid = profile.usage?.config?.prepaidBalance?.val;
    if (prepaid !== undefined)
        printDetail(frame, "Prepaid credits", fmtUsd(prepaid / 100), layout);
    const onDemandUsed = profile.usage?.config?.onDemandUsed?.val;
    const onDemandCap = profile.usage?.config?.onDemandCap?.val;
    if (onDemandUsed !== undefined || onDemandCap !== undefined) {
        const cap = onDemandCap !== undefined ? ` / ${fmtUsd(onDemandCap / 100)}` : "";
        printDetail(frame, "On-demand", `${fmtUsd((onDemandUsed ?? 0) / 100)}${cap}`, layout);
    }
    if (!quota && prepaid === undefined && onDemandUsed === undefined && !identity)
        printNote(frame, "Usage data unavailable");
}
function renderGrok(profiles, options) {
    const width = resolveWidth(options);
    const frame = new Frame(width);
    const numbered = options.numbered ?? false;
    const startIndex = options.startIndex ?? 1;
    frame.sectionStart("Grok Build", profiles.length, "profile", options.tight ?? false);
    if (profiles.length === 0) {
        printNote(frame, "No profiles configured · run 'aacc grok add'");
    }
    else {
        const measured = collectGrokLayout(profiles);
        const layout = options.labelWidth !== undefined && options.resetWidth !== undefined
            ? { labelWidth: options.labelWidth, resetWidth: options.resetWidth }
            : measureLayout(measured.labels, measured.resets, width);
        for (let i = 0; i < profiles.length; i++) {
            if (i > 0)
                frame.divider();
            displayGrokProfile(frame, profiles[i], layout, numbered ? startIndex + i : undefined);
        }
    }
    frame.sectionEnd();
    return frame.lines;
}
export function renderGrokProfiles(profiles, options = {}) {
    return renderGrok(profiles, options);
}
export function displayGrokProfiles(profiles) {
    writeLines(renderGrok(profiles, { numbered: false }));
}
export function displayGrokProfilesNumbered(profiles) {
    writeLines(renderGrok(profiles, { numbered: true }));
}
export function renderCombinedUsage(data, options = {}) {
    const width = resolveWidth(options);
    const numbered = options.numbered ?? false;
    const tight = options.tight ?? false;
    const lines = [];
    let nextIndex = options.startIndex ?? 1;
    const codex = collectCodexLayout(data.codex);
    const claude = collectClaudeLayout(data.claude);
    const grok = collectGrokLayout(data.grok);
    const layout = measureLayout([...codex.labels, ...claude.labels, ...grok.labels], [...codex.resets, ...claude.resets, ...grok.resets], width);
    const push = (section) => {
        if (lines.length && section[0] !== "")
            lines.push("");
        lines.push(...section);
    };
    const shared = { width, numbered, tight: true, labelWidth: layout.labelWidth, resetWidth: layout.resetWidth };
    push(renderCodex(data.codex, { ...shared, startIndex: nextIndex }));
    if (numbered)
        nextIndex += data.codex.length;
    push(renderClaude(data.claude, { ...shared, startIndex: nextIndex }));
    if (numbered)
        nextIndex += data.claude.length;
    push(renderGrok(data.grok, { ...shared, startIndex: nextIndex }));
    if (!tight && lines[0] !== "")
        lines.unshift("");
    return lines;
}
export function composeDashboardFrame(body, chrome, size) {
    const width = dashboardWidth(size);
    const rows = Math.max(1, size.rows);
    const updated = chrome.updatedAt
        ? chrome.updatedAt.toLocaleTimeString()
        : "";
    const refresh = chrome.refreshing
        ? "refreshing…"
        : chrome.intervalSeconds
            ? `refresh ${chrome.intervalSeconds}s`
            : "";
    const title = chrome.title ?? "Usage";
    const meta = [updated && `updated ${updated}`, refresh].filter(Boolean).join(" · ");
    const headerLeft = `${title}`;
    const header = meta
        ? `${BOLD}${headerLeft}${RESET}${DIM}  ${meta}${RESET}`
        : `${BOLD}${headerLeft}${RESET}`;
    const help = chrome.help ?? "q quit";
    const message = chrome.message ? `${chrome.message}  ·  ${help}` : help;
    const footer = `${DIM}${message}${RESET}`;
    const frame = [padVisible(header, width)];
    const bodyBudget = Math.max(0, rows - 2);
    const clipped = clipBody(body, bodyBudget, width);
    for (const line of clipped)
        frame.push(padVisible(line, width));
    frame.push(padVisible(footer, width));
    return frame.slice(0, rows);
}
function clipBody(body, budget, width) {
    if (budget <= 0)
        return [];
    if (body.length <= budget)
        return body.map(line => padVisible(line, width));
    if (budget === 1)
        return [`${DIM}${truncateVisible("… truncated", width)}${RESET}`];
    const head = body.slice(0, budget - 1).map(line => padVisible(line, width));
    head.push(`${DIM}${truncateVisible("… truncated to terminal height", width)}${RESET}`);
    return head;
}
function writeLines(lines) {
    if (!lines.length)
        return;
    console.log(lines.join("\n"));
}
//# sourceMappingURL=display.js.map