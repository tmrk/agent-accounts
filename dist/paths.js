import { cpSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
export const STORE_DIR = join(homedir(), ".agent-accounts");
export const LEGACY_STORE_DIR = join(homedir(), ".codex-accounts");
let migrationChecked = false;
/**
 * Initialize the renamed store. Existing codex-accounts data is copied once,
 * so installing agent-accounts does not sign users out or alter the old app.
 */
export function ensureStoreDir() {
    if (migrationChecked)
        return;
    migrationChecked = true;
    if (!existsSync(STORE_DIR) && existsSync(LEGACY_STORE_DIR)) {
        cpSync(LEGACY_STORE_DIR, STORE_DIR, {
            recursive: true,
            preserveTimestamps: true,
        });
    }
    mkdirSync(STORE_DIR, { recursive: true, mode: 0o700 });
}
//# sourceMappingURL=paths.js.map