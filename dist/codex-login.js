import { spawn } from "node:child_process";
import { codexLoginArgs } from "./add-options.js";
export async function runCodexLogin(options = { deviceAuth: false }, runner = spawnCodexLogin, spawnOptions) {
    const args = codexLoginArgs(options);
    const displayed = `codex ${args.join(" ")}`;
    let result;
    try {
        result = await runner("codex", args, spawnOptions);
    }
    catch (err) {
        throw new Error(`Failed to run '${displayed}': ${err.message}. Is codex installed?`);
    }
    if (result.code !== 0) {
        throw new Error(`${displayed} exited with code ${result.code}`);
    }
}
function spawnCodexLogin(command, args, spawnOptions) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            stdio: "inherit",
            env: spawnOptions?.env ?? process.env,
        });
        child.on("error", reject);
        child.on("close", code => {
            resolve({ code: code ?? 1 });
        });
    });
}
//# sourceMappingURL=codex-login.js.map