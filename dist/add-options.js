/** `aacc add claude` / `aacc login grok` select a provider. Flat `aacc add` stays Codex. */
export function parseProviderInvocation(args) {
    const command = args[0];
    if (command !== "add" && command !== "login")
        return null;
    const provider = args[1];
    if (provider !== "codex" && provider !== "claude" && provider !== "grok")
        return null;
    return { provider, rest: [command, ...args.slice(2)] };
}
export function parseAddArgs(args) {
    const options = { deviceAuth: false };
    for (const arg of args) {
        switch (arg) {
            case "--device-auth":
                options.deviceAuth = true;
                break;
            default:
                if (arg.startsWith("-")) {
                    throw new Error(`Unknown add option: ${arg}`);
                }
                throw new Error(`Unexpected extra argument: ${arg}`);
        }
    }
    return options;
}
/** Args passed to the `codex` binary for login. */
export function codexLoginArgs(options) {
    const args = ["login"];
    if (options.deviceAuth)
        args.push("--device-auth");
    // Isolated logins write auth.json under CODEX_HOME instead of the OS keyring.
    args.push("-c", "cli_auth_credentials_store=file");
    return args;
}
//# sourceMappingURL=add-options.js.map