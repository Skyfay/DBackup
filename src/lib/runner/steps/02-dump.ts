import { RunnerContext } from "../types";
import { executeCombinedDump } from "./combined-dump";

/**
 * Produces the backup file for this run.
 *
 * Every job writes a seekable archive, whether it backs up databases, directory sources or
 * both, so there is a single path. Backups written in the older formats (a bare dump, or a
 * TAR of dumps with a version 1 manifest) are still restored by the restore pipeline, but no
 * job produces them anymore.
 */
export async function stepExecuteDump(ctx: RunnerContext) {
    if (!ctx.job) throw new Error("Context not initialized");
    if (!ctx.sourceAdapter && (!ctx.sources || ctx.sources.length === 0)) {
        throw new Error("Job has no source configured");
    }

    return executeCombinedDump(ctx);
}
