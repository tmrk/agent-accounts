export const DEFAULT_LIVE_INTERVAL_SECONDS = 30;
export const MIN_LIVE_INTERVAL_SECONDS = 5;
export const MAX_LIVE_INTERVAL_SECONDS = 60 * 60;
function parseInterval(value) {
    const seconds = Number(value);
    if (!Number.isInteger(seconds)
        || seconds < MIN_LIVE_INTERVAL_SECONDS
        || seconds > MAX_LIVE_INTERVAL_SECONDS) {
        throw new Error(`--interval must be a whole number from ${MIN_LIVE_INTERVAL_SECONDS} to ${MAX_LIVE_INTERVAL_SECONDS} seconds.`);
    }
    return seconds;
}
/** Pull global live-view flags out of a command without disturbing other arguments. */
export function parseLiveArgs(args) {
    const remaining = [];
    let enabled = false;
    let intervalSeconds = DEFAULT_LIVE_INTERVAL_SECONDS;
    let hasInterval = false;
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === "--live") {
            enabled = true;
            continue;
        }
        if (arg.startsWith("--live=")) {
            enabled = true;
            intervalSeconds = parseInterval(arg.slice("--live=".length));
            hasInterval = true;
            continue;
        }
        if (arg === "--interval") {
            const value = args[++i];
            if (value === undefined)
                throw new Error("--interval requires a value in seconds.");
            intervalSeconds = parseInterval(value);
            hasInterval = true;
            continue;
        }
        if (arg.startsWith("--interval=")) {
            intervalSeconds = parseInterval(arg.slice("--interval=".length));
            hasInterval = true;
            continue;
        }
        remaining.push(arg);
    }
    if (hasInterval && !enabled) {
        throw new Error("--interval can only be used together with --live.");
    }
    return {
        args: remaining,
        options: { enabled, intervalSeconds },
    };
}
/** Re-render a usage view until interrupted. */
export async function runLive(render, intervalSeconds) {
    let stopping = false;
    let wake;
    let firstRender = true;
    const interactive = Boolean(process.stdout.isTTY);
    const stop = () => {
        stopping = true;
        wake?.();
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    if (interactive)
        process.stdout.write("\x1b[?25l");
    try {
        while (!stopping) {
            if (interactive) {
                process.stdout.write("\x1b[2J\x1b[H");
            }
            else if (!firstRender) {
                console.log("\n---");
            }
            firstRender = false;
            const updatedAt = new Date().toLocaleTimeString();
            console.log(`\x1b[1mLive usage\x1b[0m \x1b[2m(updated ${updatedAt}; refresh ${intervalSeconds}s; Ctrl-C to stop)\x1b[0m`);
            try {
                await render();
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                console.error(`\nRefresh failed: ${message}`);
            }
            if (stopping)
                break;
            await new Promise((resolve) => {
                const timer = setTimeout(resolve, intervalSeconds * 1000);
                wake = () => {
                    clearTimeout(timer);
                    resolve();
                };
            });
            wake = undefined;
        }
    }
    finally {
        process.off("SIGINT", stop);
        process.off("SIGTERM", stop);
        if (interactive)
            process.stdout.write("\x1b[?25h\n");
    }
}
//# sourceMappingURL=live.js.map