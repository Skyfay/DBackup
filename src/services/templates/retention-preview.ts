import type { FileInfo } from "@/lib/core/interfaces";
import type { RetentionConfiguration } from "@/lib/core/retention";
import { simulateRetention } from "@/services/storage/explorer-plan";
import type { RetentionTarget } from "./templates-types";

/**
 * What a retention policy removes at the destinations it reaches, worked out in the browser while
 * the policy is edited. Plain functions over the backups the destinations hold now.
 */

/** The backups of a destination the way the retention of the runner sees them. */
function filesOf(target: RetentionTarget): FileInfo[] {
    return target.backups.map((backup, index) => ({
        name: `backup-${index}`,
        path: `backup-${index}`,
        size: 0,
        lastModified: new Date(backup.at),
        backupTimestamp: new Date(backup.at),
        locked: backup.locked,
        chainId: backup.chainId ?? undefined,
    }));
}

/**
 * How many of the backups a destination holds now its next run removes under this policy. The run
 * adds its own backup first and the retention runs after it, the way the runner does it, so a chain
 * goes as a whole and a locked backup stays. A paused job is judged as if it ran now.
 */
export function removedByNextRun(target: RetentionTarget, config: RetentionConfiguration, timezone: string, now = Date.now()): number {
    const at = target.nextRun ? Date.parse(target.nextRun) : now;
    return simulateRetention(filesOf(target), [{ at }], config, timezone, target.chains)[0]?.count ?? 0;
}

/** Most backups a destination keeps under a policy, null for one that keeps everything. The tiers add up. */
export function mostKept(config: RetentionConfiguration): number | null {
    if (config.mode === "SIMPLE") return config.simple?.keepCount ?? null;
    if (config.mode === "SMART" && config.smart) {
        const { hourly = 0, daily, weekly, monthly, yearly } = config.smart;
        return hourly + daily + weekly + monthly + yearly;
    }
    return null;
}
