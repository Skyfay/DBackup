import { execFile } from "child_process";
import { promisify } from "util";
import { logger } from "@/lib/logger";

const execFileAsync = promisify(execFile);
const log = logger.child({ adapter: "postgres", module: "version-utils" });

/**
 * Finds the correct PostgreSQL binary path for a specific major version.
 *
 * This is crucial to avoid compatibility issues where pg_dump version 17
 * creates dumps with PG17-specific syntax (like transaction_timeout) that
 * fail to restore on PG16 or earlier.
 *
 * Uses intelligent fallback strategy:
 * - If exact version not found, uses next higher version (backward compatible)
 * - Example: PG 13 server → uses pg_dump 14 (if available)
 * - Strategic versions: 14 (covers 12-14), 16 (covers 15-16), 18 (covers 17-18)
 *
 * Search order:
 * 1. Exact version match
 * 2. Next higher strategic version (14, 16, 18)
 * 3. Generic fallback (uses $PATH default)
 *
 * @param tool - The tool name (pg_dump, pg_restore, psql)
 * @param targetVersion - Target major version (e.g., "16.1" → returns PG16 binary)
 * @returns The full path to the binary, or the generic tool name as fallback
 */
export async function getPostgresBinary(tool: 'pg_dump' | 'pg_restore' | 'psql', targetVersion?: string): Promise<string> {
    if (!targetVersion) {
        // No version detected, use default from PATH
        return tool;
    }

    // Extract major version (e.g., "PostgreSQL 16.1 on..." → "16")
    const majorMatch = targetVersion.match(/(\d+)\./);
    if (!majorMatch) {
        return tool;
    }
    const majorVersion = parseInt(majorMatch[1], 10);

    // Strategic versions we support (covers all via backward compatibility)
    const strategicVersions = [14, 16, 18];

    // Find the best matching version:
    // 1. Try exact match first
    // 2. Fall back to next higher strategic version
    const versionsToTry: number[] = [];

    // Add exact version
    versionsToTry.push(majorVersion);

    // Add next higher strategic versions as fallbacks
    for (const strategic of strategicVersions) {
        if (strategic >= majorVersion && !versionsToTry.includes(strategic)) {
            versionsToTry.push(strategic);
        }
    }

    // Try each version in order
    for (const version of versionsToTry) {
        const candidatePaths = [
            // Homebrew (macOS) - versioned installations
            `/opt/homebrew/opt/postgresql@${version}/bin/${tool}`,
            `/usr/local/opt/postgresql@${version}/bin/${tool}`,

            // Alpine Linux (Docker) - custom symlinks from Dockerfile
            `/opt/pg${version}/bin/${tool}`,

            // Alpine Linux - direct libexec paths
            `/usr/libexec/postgresql${version}/${tool}`,

            // Linux package manager versioned installations
            `/usr/lib/postgresql/${version}/bin/${tool}`,
            `/usr/pgsql-${version}/bin/${tool}`,
        ];

        for (const candidatePath of candidatePaths) {
            try {
                // Check if file exists and is executable
                const { stdout } = await execFileAsync(candidatePath, ['--version'], { timeout: 2000 });

                // Verify the version matches
                if (stdout.includes(`${version}.`)) {
                    if (version !== majorVersion) {
                        log.info("Using backward compatible pg_dump version", { toolVersion: version, serverVersion: majorVersion });
                    }
                    return candidatePath;
                }
            } catch {
                // File doesn't exist or isn't executable, continue
                continue;
            }
        }
    }

    // Final fallback: check generic system paths for latest version
    const genericPaths = [
        `/opt/homebrew/opt/postgresql/bin/${tool}`,
        `/usr/local/opt/postgresql/bin/${tool}`,
        `/usr/bin/${tool}`,
        `/usr/local/bin/${tool}`,
    ];

    for (const genericPath of genericPaths) {
        try {
            await execFileAsync(genericPath, ['--version'], { timeout: 2000 });
            log.warn("Could not find strategic version, using system default", { targetVersion: majorVersion, path: genericPath });
            return genericPath;
        } catch {
            continue;
        }
    }

    // Last resort: use generic tool name from PATH
    log.warn("Could not find tool for version, using default from PATH", { tool, targetVersion: majorVersion });
    return tool;
}

/**
 * Get the major version number from a full PostgreSQL version string
 *
 * @param versionString - Full version string (e.g., "PostgreSQL 16.1 on x86_64...")
 * @returns Major version number (e.g., 16) or null
 */
export function extractMajorVersion(versionString: string): number | null {
    const match = versionString.match(/(\d+)\./);
    return match ? parseInt(match[1], 10) : null;
}
