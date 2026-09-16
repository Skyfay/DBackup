import path from "path";
import fs from "fs/promises";
import { RunnerContext } from "../types";
import { createHost, resolveTransport } from "@/lib/transport";
import { resolveAdapterConfig } from "@/lib/adapters/config-resolver";
import { ArchiveSourceEntry, DumpFormat } from "@/lib/archive/types";
import { EXTENSION_BY_FORMAT } from "@/lib/archive/format";
import { PIPELINE_STAGES } from "@/lib/core/logs";
import { parseJobDatabases, watchDumpSize } from "./dump-helpers";

/**
 * On-disk format of each adapter's single-database dump.
 *
 * Every database adapter needs an entry. A missing one is a programming error rather than a
 * reason to guess, because the format decides the extension a restore hands to the engine's
 * own tools.
 */
export const DB_FORMAT_BY_ADAPTER: Record<string, DumpFormat> = {
    mysql: "sql",
    mariadb: "sql",
    postgres: "custom",
    mongodb: "archive",
    firebird: "fbk",
    mssql: "bak",
    "azure-sql": "bacpac",
    redis: "rdb",
    valkey: "rdb",
    sqlite: "sqlite",
};

export function dumpFormatFor(adapterId: string): DumpFormat {
    const format = DB_FORMAT_BY_ADAPTER[adapterId];
    if (!format) {
        throw new Error(`No dump format is defined for database adapter '${adapterId}'`);
    }
    return format;
}

/**
 * Whether an adapter's dump is already compressed, so the archive stores it as-is instead
 * of compressing compressed bytes again. pg_dump compresses unless the job turned it off,
 * mongodump always runs with --gzip, and a BACPAC is a ZIP.
 */
export function hasNativeCompression(adapterId: string, pgCompression?: string | null): boolean {
    if (adapterId === "postgres") return pgCompression !== "NONE";
    return adapterId === "mongodb" || adapterId === "azure-sql";
}

/**
 * Removes `--all-databases` from a source's extra dump options.
 *
 * Every database is its own entry now, dumped with its own name. The flag would make each of
 * those dumps contain the whole server, so it is dropped rather than passed through.
 */
export function stripAllDatabasesOption(options: unknown): { options: unknown; stripped: boolean } {
    if (typeof options !== "string" || !/(^|\s)--all-databases(\s|$)/.test(options)) {
        return { options, stripped: false };
    }
    return {
        options: options.split(/\s+/).filter((part) => part.length > 0 && part !== "--all-databases").join(" "),
        stripped: true,
    };
}

export interface DumpedDatabases {
    entries: ArchiveSourceEntry[];
    dbNames: string[];
    engineVersion?: string;
    engineEdition?: string;
}

/**
 * Dumps every database of the job's source into its own local file, ready for the archive.
 *
 * The database name never becomes part of a local path. Files are numbered instead, because
 * a name is whatever the backed-up server allows, and the archive writer sanitizes it for
 * the member name on its own.
 */
export async function dumpDatabases(ctx: RunnerContext, workDir: string): Promise<DumpedDatabases> {
    const job = ctx.job!;
    const adapter = ctx.sourceAdapter!;
    const adapterId = job.source!.adapterId;

    if (!adapter.dumpOne) {
        throw new Error(`Database adapter '${adapterId}' cannot write a backup in the seekable archive format`);
    }
    const format = dumpFormatFor(adapterId);

    const sourceConfig = await resolveAdapterConfig(job.source!) as Record<string, unknown>;
    sourceConfig.type = adapterId;
    if (job.pgCompression !== undefined) {
        sourceConfig.pgCompression = job.pgCompression;
    }
    const cleaned = stripAllDatabasesOption(sourceConfig.options);
    if (cleaned.stripped) {
        sourceConfig.options = cleaned.options;
        ctx.log("Ignoring '--all-databases' in the source options: every database is dumped on its own.", "warning");
    }

    // One transport for the database phase. It is released before directory sources are
    // collected, so no connection sits idle through a long file transfer.
    const host = createHost(resolveTransport(adapter, sourceConfig));
    try {
        const selected = parseJobDatabases(job.databases);
        let dbNames: string[] = [];

        if (adapter.listDumpEntries) {
            dbNames = await adapter.listDumpEntries(sourceConfig, selected, host);
        } else if (selected.length > 0) {
            dbNames = selected;
        } else if (adapter.getDatabases) {
            ctx.log("No databases selected - auto-discovering all databases...");
            try {
                dbNames = await adapter.getDatabases(sourceConfig, host);
            } catch (e: unknown) {
                const message = e instanceof Error ? e.message : String(e);
                ctx.log(`Warning: Could not auto-discover databases: ${message}`, "warning");
            }
        }

        if (dbNames.length === 0) {
            throw new Error("No databases found to back up. Select the databases in the job explicitly.");
        }
        ctx.log(`Databases to dump: ${dbNames.join(", ")}`);

        let engineVersion: string | undefined;
        let engineEdition: string | undefined;
        if (adapter.test) {
            try {
                const testRes = await adapter.test(sourceConfig, host) as { success: boolean; version?: string; edition?: string };
                if (testRes.success && testRes.version) {
                    engineVersion = testRes.version;
                    ctx.log(`Detected engine version: ${engineVersion}`);
                }
                if (testRes.edition) engineEdition = testRes.edition;
            } catch { /* ignore - cosmetic metadata only */ }
        }

        const nativeCompression = hasNativeCompression(adapterId, job.pgCompression);
        const entries: ArchiveSourceEntry[] = [];
        ctx.setStage(PIPELINE_STAGES.DUMPING);

        for (const [position, dbName] of dbNames.entries()) {
            // Between databases rather than only between steps, so cancelling a multi-DB job
            // does not have to wait out every remaining dump first.
            ctx.abortSignal?.throwIfAborted();

            const dest = path.join(workDir, "databases", `${String(position + 1).padStart(4, "0")}.${EXTENSION_BY_FORMAT[format]}`);
            await fs.mkdir(path.dirname(dest), { recursive: true });

            ctx.log(`Dumping database: ${dbName}`, "info");
            const stopWatching = watchDumpSize(ctx, dest, dbName);
            try {
                await adapter.dumpOne(
                    { ...sourceConfig, detectedVersion: engineVersion },
                    dbName,
                    dest,
                    host,
                    (msg, level, type, details) => ctx.log(msg, level, type, details)
                );
            } finally {
                stopWatching();
            }

            entries.push({ kind: "database", dbName, path: dest, format, nativeCompression });
            ctx.updateStageProgress(Math.round(((position + 1) / dbNames.length) * 100));
            ctx.log(`Completed dump for: ${dbName}`, "success");
        }

        return { entries, dbNames, engineVersion, engineEdition };
    } finally {
        await host.dispose().catch(() => {});
    }
}
