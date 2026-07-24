import path from "path";
import prisma from "@/lib/prisma";
import { getTempDir } from "@/lib/temp-dir";
import { applyNamingPattern, chainSegment, patternUsesChain } from "@/lib/templates/naming-template-engine";
import { JobWithRelations } from "../types";

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
 * Resolves the final backup filename/temp path for a job, using the same timezone/naming
 * pattern resolution 02-dump.ts uses for its own (untouched) single-adapter path. Used only by
 * the combined dump path (executeCombinedDump) - a combined archive is always a TAR regardless
 * of which database adapter (if any) is involved, so the extension is hardcoded rather than
 * derived from an adapterId.
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

    const dbNameRaw = jobDatabases.length === 0
        ? 'all'
        : jobDatabases.map(db => db.replace(/[^a-z0-9]/gi, '_')).join('_');
    const sanitizedName = job.name.replace(/[^a-z0-9]/gi, '_');

    // Only an incremental run has a position to write; for everything else the token resolves
    // to nothing and takes its separator with it.
    const chainValue = chain ? chainSegment(chain.type, chain.index) : "";
    const fileName = applyNamingPattern(pattern, sanitizedName, dbNameRaw, new Date(), timezone, chainValue) + ".tar";
    const tempDir = getTempDir();
    const tempFile = path.join(tempDir, fileName);

    return { tempDir, tempFile, fileName, chainInFileName: patternUsesChain(pattern) };
}

/** Parses Job.databases (a JSON string array) defensively, same convention as 02-dump.ts. */
export function parseJobDatabases(databasesJson: string | null | undefined): string[] {
    try {
        const parsed = JSON.parse(databasesJson || "[]");
        return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string' && s.trim().length > 0) : [];
    } catch {
        return [];
    }
}
