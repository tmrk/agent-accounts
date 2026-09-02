export interface AddOptions {
  deviceAuth: boolean;
}

export function parseAddArgs(args: string[]): AddOptions {
  const options: AddOptions = { deviceAuth: false };

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
export function codexLoginArgs(options: AddOptions): string[] {
  const args = ["login"];
  if (options.deviceAuth) args.push("--device-auth");
  // Isolated logins write auth.json under CODEX_HOME instead of the OS keyring.
  args.push("-c", "cli_auth_credentials_store=file");
  return args;
}
