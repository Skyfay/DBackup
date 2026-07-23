import prisma from "@/lib/prisma";

/** Default files transferred in parallel when the setting has never been saved. */
export const DEFAULT_MAX_CONCURRENT_FILES = 4;
/** Upper bound the settings form enforces; clamped here too so a hand-edited DB value can't misbehave. */
export const MAX_CONCURRENT_FILES_LIMIT = 16;

/**
 * How many files the file-backup and file-restore paths transfer at once.
 *
 * Read at the start of each run rather than cached, so changing the setting takes effect on
 * the next job without a restart - the same live-read pattern the queue's `maxConcurrentJobs`
 * uses. Falls back to the default when unset and clamps to the form's [1, 16] range, so a
 * malformed or out-of-range stored value can never widen concurrency past the intended cap.
 */
export async function getMaxConcurrentFiles(): Promise<number> {
    const setting = await prisma.systemSetting.findUnique({ where: { key: "maxConcurrentFiles" } });
    const parsed = setting ? parseInt(setting.value, 10) : NaN;
    if (!Number.isFinite(parsed)) return DEFAULT_MAX_CONCURRENT_FILES;
    return Math.min(MAX_CONCURRENT_FILES_LIMIT, Math.max(1, parsed));
}
