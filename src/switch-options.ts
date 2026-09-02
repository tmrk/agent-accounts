export interface SwitchOptions {
  restartCodexGui: boolean;
}

export interface ParsedSwitchArgs {
  identifier?: string;
  options: SwitchOptions;
}

export function parseSwitchArgs(args: string[], defaults: SwitchOptions = { restartCodexGui: false }): ParsedSwitchArgs {
  let identifier: string | undefined;
  const options = { ...defaults };

  for (const arg of args) {
    switch (arg) {
      case "--restart-codex-gui":
      case "--restart-gui":
        options.restartCodexGui = true;
        break;
      case "--no-restart-codex-gui":
      case "--no-restart-gui":
        options.restartCodexGui = false;
        break;
      default:
        if (arg.startsWith("-")) {
          throw new Error(`Unknown switch option: ${arg}`);
        }
        if (identifier !== undefined) {
          throw new Error(`Unexpected extra account selector: ${arg}`);
        }
        identifier = arg;
        break;
    }
  }

  return { identifier, options };
}
