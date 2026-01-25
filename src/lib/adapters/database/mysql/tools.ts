import { execSync } from "child_process";

// Cache detection results to avoid spawning processes repeatedly
let cachedMysqlCmd: string | null = null;
let cachedMysqldumpCmd: string | null = null;
let cachedMysqladminCmd: string | null = null;

function detectCommand(candidates: string[]): string {
    for (const cmd of candidates) {
        try {
            // "command -v" is a shell builtin, but execSync executes via shell (/bin/sh)
            execSync(`command -v ${cmd}`, { stdio: 'ignore' });
            return cmd;
        } catch {
            continue;
        }
    }
    // Fallback to the first candidate if nothing works (let it fail later with a clear error)
    return candidates[0];
}

export function getMysqlCommand(): string {
    if (cachedMysqlCmd) return cachedMysqlCmd;
    // Prefer strict 'mariadb' if available (Alpine/MariaDB clients), then 'mysql'
    cachedMysqlCmd = detectCommand(['mariadb', 'mysql']);
    return cachedMysqlCmd;
}

export function getMysqldumpCommand(): string {
    if (cachedMysqldumpCmd) return cachedMysqldumpCmd;
    // Prefer 'mariadb-dump' (Alpine), then 'mysqldump'
    cachedMysqldumpCmd = detectCommand(['mariadb-dump', 'mysqldump']);
    return cachedMysqldumpCmd;
}

export function getMysqladminCommand(): string {
    if (cachedMysqladminCmd) return cachedMysqladminCmd;
    // Prefer 'mariadb-admin', then 'mysqladmin'
    cachedMysqladminCmd = detectCommand(['mariadb-admin', 'mysqladmin']);
    return cachedMysqladminCmd;
}
