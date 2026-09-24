import path from "path";
import prisma from "@/lib/prisma";
import { getTempDir } from "@/lib/temp-dir";
import { applyNamingPattern, chainSegment, fileNameParts, patternUsesChain } from "@/lib/templates/naming-template-engine";
import fs from "fs/promises";
import { formatBytes } from "@/lib/utils";
import { JobWithRelations, RunnerContext } from "../types";

export interface ResolvedBackupFilename {
    tempDir: string;
    tempFile: string;
    fileName: string;
    /**
     * True when the pattern placed the chain segment itself. The upload step prepends it only
     * when this is false, so the position appears exactly once.
     */
    chainInFileName: boolean;
}

/**
 * Resolves the final backup filename and temp path for a job from its naming template. Every
 * backup is a seekable archive, which is a TAR whatever the source, so the extension is fixed
 * rather than derived from an adapter.
 */
export async function resolveBackupFilename(
    job: JobWithRelations,
    chain?: { type: "full" | "incremental"; index: number }
): Promise<ResolvedBackupFilename> {
    const [tzSetting, patternSetting, namingTemplate] = await Promise.all([
        prisma.systemSetting.findUnique({ where: { key: "system.timezone" } }),
        prisma.systemSetting.findUnique({ where: { key: "system.filenamePattern" } }),
        job.namingTemplateId
            ? prisma.namingTemplate.findUnique({ where: { id: job.namingTemplateId } })
            : prisma.namingTemplate.findFirst({ where: { isDefault: true } }),
    ]);
    const timezone = tzSetting?.value || "UTC";
    const pattern = namingTemplate?.pattern ?? patternSetting?.value ?? "{job_name}_yyyy-MM-dd_HH-mm-ss";

    const jobDatabases: string[] = (() => {
        try {
            const parsed = JSON.parse(job.databases || "[]");
            return Array.isArray(parsed) ? parsed : [];
        } catch { return []; }
    })();

    const { jobName: sanitizedName, dbName: dbNameRaw } = fileNameParts(job.name, jobDatabases);

    // Only an incremental run has a position to write; for everything else the token resolves
    // to nothing and takes its separator with it.
    const chainValue = chain ? chainSegment(chain.type, chain.index) : "";
    const fileName = applyNamingPattern(pattern, sanitizedName, dbNameRaw, new Date(), timezone, chainValue) + ".tar";
    const tempDir = getTempDir();
    const tempFile = path.join(tempDir, fileName);

    return { tempDir, tempFile, fileName, chainInFileName: patternUsesChain(pattern) };
}

/** Parses Job.databases (a JSON string array) defensively. */
export function parseJobDatabases(databasesJson: string | null | undefined): string[] {
    try {
        const parsed = JSON.parse(databasesJson || "[]");
        return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string' && s.trim().length > 0) : [];
    } catch {
        return [];
    }
}

/**
 * Shows how far a running dump has got, by watching its file grow.
 *
 * Adapters write their dump straight to disk and report no byte counts of their own, so the
 * file size is the only live progress there is. Returns the function that stops watching.
 */
export function watchDumpSize(ctx: RunnerContext, file: string, label: string): () => void {
    const startedAt = Date.now();
    const timer = setInterval(() => {
        fs.stat(file).then((stats) => {
            if (stats.size === 0) return;
            const elapsed = (Date.now() - startedAt) / 1000;
            const speed = elapsed > 0 ? Math.round(stats.size / elapsed) : 0;
            ctx.updateDetail(`${label}: ${formatBytes(stats.size)} dumped - ${formatBytes(speed)}/s`);
        }, () => { /* not written yet */ });
    }, 800);
    return () => clearInterval(timer);
}
