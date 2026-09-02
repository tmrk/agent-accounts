export declare const STORE_DIR: string;
export declare const LEGACY_STORE_DIR: string;
/**
 * Initialize the renamed store. Existing codex-accounts data is copied once,
 * so installing agent-accounts does not sign users out or alter the old app.
 */
export declare function ensureStoreDir(): void;
