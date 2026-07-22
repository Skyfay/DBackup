import path from "path";
import fs from "fs/promises";
import { RunnerContext } from "../types";
import { resolveAdapterConfig } from "@/lib/adapters/config-resolver";
import { downloadDirectory } from "@/lib/adapters/storage/common/download-directory";
import { createCombinedTar, createTempDir, cleanupTempDir } from "@/lib/adapters/database/common/tar-utils";
import { CombinedTarFileEntry, DbEntryV2, DirectoryFileIndexEntry } from "@/lib/adapters/database/common/types";
import { resolveBackupFilename, parseJobDatabases } from "./dump-helpers";
import { formatBytes } from "@/lib/utils";
import { calculateFileChecksum } from "@/lib/crypto/checksum";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";

const log = logger.child({ step: "combined-dump" });

/** Per-adapter dump format, matching what each adapter's own multi-DB path already uses internally. */
const DB_FORMAT_BY_ADAPTER: Record<string, DbEntryV2["format"]> = {
    mysql: "sql",
    mariadb: "sql",
    postgres: "custom",
    mongodb: "archive",
    firebird: "fbk",
};

/** Adapters whose dump() already applies its own native compression - per-entry external compression is skipped for their dumps to avoid double-compressing already-compressed bytes. */
const NATIVE_COMPRESSION_ADAPTERS = new Set(["postgres"]);

/**
 * Combined dump path for jobs that have directory sources (JobSource), used instead of the
 * unchanged single-adapter path in 02-dump.ts. Dumps every selected database individually via
 * dumpOne() (no limit on count - Multi-DB is fully supported here, exactly as in a DB-only job),
 * downloads every directory source via downloadDirectory(), then combines everything into ONE
 * archive via createCombinedTar() (manifest v2). Only ever invoked when ctx.sources.length > 0 -
 * see the guard clause in 02-dump.ts.
 */
export async function executeCombinedDump(ctx: RunnerContext): Promise<void> {
    if (!ctx.job) throw new Error("Context not initialized");
    const job = ctx.job;

    const sourceLabel = job.source ? `${job.source.name} (${job.source.type})` : "no database source";
    ctx.log(`Starting combined dump: ${sourceLabel} + ${ctx.sources.length} directory source(s)...`);

    const { tempFile } = await resolveBackupFilename(job);
    ctx.tempFile = tempFile;
    ctx.log(`Prepared temporary path: ${tempFile}`);

    const workDir = await createTempDir("combined-dump-");
    const entries: CombinedTarFileEntry[] = [];
    let dbNames: string[] = [];
    let engineVersion: string | undefined;
    let engineEdition: string | undefined;
    let sourceConfig: Record<string, unknown> | undefined;

    try {
        // ── Database portion (only if the job has a database source) ──────────────
        if (ctx.sourceAdapter && job.source) {
            if (!ctx.sourceAdapter.dumpOne) {
                // Should already be blocked at job-create/update time (JobService); defensive check.
                throw new Error(`Database adapter '${job.source.adapterId}' does not support combined backups with directory sources`);
            }

            sourceConfig = await resolveAdapterConfig(job.source) as Record<string, unknown>;
            sourceConfig.type = job.source.adapterId;
            if (job.pgCompression !== undefined) {
                sourceConfig.pgCompression = job.pgCompression;
            }

            dbNames = parseJobDatabases(job.databases);
            if (dbNames.length === 0 && ctx.sourceAdapter.getDatabases) {
                ctx.log("No databases selected - auto-discovering all databases...");
                try {
                    dbNames = await ctx.sourceAdapter.getDatabases(sourceConfig);
                } catch (e: unknown) {
                    const message = e instanceof Error ? e.message : String(e);
                    ctx.log(`Warning: Could not auto-discover databases: ${message}`, 'warning');
                }
            }
            if (dbNames.length === 0) {
                throw new Error("No databases found to back up");
            }
            ctx.log(`Databases to dump: ${dbNames.join(', ')}`);

            if (ctx.sourceAdapter.test) {
                try {
                    const testRes = await ctx.sourceAdapter.test(sourceConfig) as { success: boolean; version?: string; edition?: string };
                    if (testRes.success && testRes.version) {
                        engineVersion = testRes.version;
                        ctx.log(`Detected engine version: ${engineVersion}`);
                    }
                    if (testRes.edition) engineEdition = testRes.edition;
                } catch { /* ignore - cosmetic metadata only */ }
            }
        }

        const totalUnits = dbNames.length + ctx.sources.length;
        let completedUnits = 0;
        const setOverallProgress = (fractionalUnitsDone: number) => {
            if (totalUnits === 0) return;
            const percent = Math.round((fractionalUnitsDone / totalUnits) * 100);
            ctx.updateStageProgress(Math.min(100, Math.max(0, percent)));
        };

        // Postgres applies its own native compression (pg_dump -Z) unless explicitly disabled via
        // pgCompression "NONE" - per-entry external compression is skipped for its dumps below to
        // avoid double-compressing already-compressed bytes.
        const nativeCompressionActive = job.source
            ? NATIVE_COMPRESSION_ADAPTERS.has(job.source.adapterId) && job.pgCompression !== "NONE"
            : false;

        // ── Database dumps (one per selected database - Multi-DB fully supported) ──
        for (const dbName of dbNames) {
            const format = DB_FORMAT_BY_ADAPTER[job.source!.adapterId] ?? "sql";
            const dest = path.join(workDir, "databases", `${dbName}.${format}`);
            await fs.mkdir(path.dirname(dest), { recursive: true });

            ctx.log(`Dumping database: ${dbName}`, 'info');
            const dumpConfigWithVersion = { ...sourceConfig, detectedVersion: engineVersion };
            await ctx.sourceAdapter!.dumpOne!(dumpConfigWithVersion, dbName, dest, (msg, level, type, details) => ctx.log(msg, level, type, details));

            entries.push({ kind: "database", dbName, path: dest, format, nativeCompression: nativeCompressionActive });
            completedUnits++;
            setOverallProgress(completedUnits);
            ctx.log(`Completed dump for: ${dbName}`, 'success');
        }

        // ── Directory sources (each entirely independent - order doesn't matter) ──
        for (const source of ctx.sources) {
            const displayPath = source.remotePath || "/";
            const label = `${source.configName}: ${displayPath}`;
            const logPrefix = `[Directory: ${displayPath} via ${source.configName}]`;
            ctx.log(`${logPrefix} Starting collection...`, 'info', 'storage');

            const localDir = path.join(workDir, "sources", source.jobSourceId);
            const unitBase = completedUnits;

            const result = await downloadDirectory(
                source.adapter,
                source.config,
                source.remotePath,
                localDir,
                source.excludePatterns,
                (processedBytes, totalBytes, processedFiles, totalFiles) => {
                    const localFraction = totalBytes > 0
                        ? processedBytes / totalBytes
                        : (totalFiles > 0 ? processedFiles / totalFiles : 0);
                    setOverallProgress(unitBase + localFraction);
                    ctx.updateDetail(`${label}: ${processedFiles}/${totalFiles} files, ${formatBytes(processedBytes)}/${formatBytes(totalBytes)}`);
                },
                (msg, level, type, details) => ctx.log(`${logPrefix} ${msg}`, level, type ?? 'storage', details)
            );

            const fileIndex: DirectoryFileIndexEntry[] = await Promise.all(result.entries.map(async (e) => ({
                path: e.relativePath,
                size: e.size,
                mtime: e.lastModified.toISOString(),
                // Content hash of the raw (pre-compression) file - groundwork for future
                // incremental-backup change detection, not yet consumed by anything else.
                checksum: await calculateFileChecksum(path.join(localDir, e.relativePath)),
            })));

            entries.push({
                kind: "directory",
                jobSourceId: source.jobSourceId,
                label,
                localPath: localDir,
                excludePatterns: source.excludePatterns,
                files: fileIndex,
            });

            completedUnits++;
            setOverallProgress(completedUnits);
            ctx.log(`${logPrefix} Collected ${result.files} file(s), ${formatBytes(result.bytes)}`, 'success', 'storage');
        }

        // ── Combine everything into one archive ────────────────────────────────────
        // Compression is applied per-entry here (skipped for natively-compressed DB dumps, always
        // applied to directory files) instead of as a single whole-file pass in 03-upload.ts - see
        // TarManifestV2.perEntryCompression.
        ctx.log(`Creating combined archive with ${dbNames.length} database(s) and ${ctx.sources.length} directory source(s)...`);
        const manifest = await createCombinedTar(entries, tempFile, {
            sourceType: job.source ? job.source.adapterId : "directory-only",
            engineVersion,
            compression: (job.compression as "NONE" | "GZIP" | "BROTLI" | undefined) ?? "NONE",
        });

        ctx.dumpSize = manifest.totalSize;
        ctx.metadata = {
            ...ctx.metadata,
            jobName: job.name,
            sourceName: job.source?.name,
            sourceType: job.source?.adapterId,
            adapterId: job.source?.adapterId,
            engineVersion,
            engineEdition,
            count: dbNames.length,
            names: dbNames,
            label: dbNames.length > 0 ? `${dbNames.length} DB(s) + ${ctx.sources.length} directory source(s)` : `${ctx.sources.length} directory source(s)`,
            combined: {
                databases: dbNames.length,
                directorySources: ctx.sources.length,
            },
        };

        const sizeStr = formatBytes(manifest.totalSize);
        ctx.log(`Combined archive created successfully. Size: ${sizeStr}`, 'success');
    } finally {
        await cleanupTempDir(workDir).catch((e) => log.warn("Failed to clean up combined-dump work directory", { workDir }, wrapError(e)));
    }
}
