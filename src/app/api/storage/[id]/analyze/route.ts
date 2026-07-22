
import { NextRequest, NextResponse } from "next/server";
import { registry } from "@/lib/core/registry";
import { registerAdapters } from "@/lib/adapters";
import { StorageAdapter, DatabaseAdapter } from "@/lib/core/interfaces";
import { resolveAdapterConfig } from "@/lib/adapters/config-resolver";
import prisma from "@/lib/prisma";
import { getTempDir } from "@/lib/temp-dir";
import path from "path";
import fs from "fs";
import { headers } from "next/headers";
import { getAuthContext, checkPermissionWithContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { archiveIndexService } from "@/services/backup/archive-index-service";
import type { BackupMetadata } from "@/lib/core/interfaces";

registerAdapters();

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
    const ctx = await getAuthContext(await headers());

    if (!ctx) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const params = await props.params;
    let tempFile: string | null = null;
    try {
        checkPermissionWithContext(ctx, PERMISSIONS.STORAGE.RESTORE);

        const body = await req.json();
        const { file, type } = body;

        if (!file || typeof file !== 'string' || file.includes('..') || file.startsWith('/')) {
            return NextResponse.json({ error: "Invalid file path" }, { status: 400 });
        }

        const storageConfig = await prisma.adapterConfig.findUnique({ where: { id: params.id } });
        if (!storageConfig || storageConfig.type !== "storage") {
            return NextResponse.json({ error: "Storage adapter not found" }, { status: 404 });
        }

        const storageAdapter = registry.get(storageConfig.adapterId) as StorageAdapter;
        if (!storageAdapter) return NextResponse.json({ error: "Storage impl missing" }, { status: 500 });

        // This relies on MySQL Adapter (or any DB adapter) to analyze the file.
        // But here we don't know the SOURCE adapter type yet because it's just a file.
        // However, we can use the MySQL adapter specifically to inspect, or assume common SQL format.
        // Better: frontend should tell us what KIND of backup this is (e.g. from the source extension).
        // But for now, we'll try to use the MySQL adapter logic since we know it's likely MySQL based on user context.
        // Ideally, we'd have a generic "SQL Analyzer" or rely on the filename extension.

        // To properly support this generically, we should accept a "type" parameter or try all adapters.
        // For this MVP, we will instantiate the MySQL adapter temporarily just to use its static-like logic,
        // OR better: we define a utility function. But since the logic is inside the adapter `analyzeDump`, we need an instance.
        // Let's use the `mysql` adapter ID hardcoded for inspection if file ends in .sql?
        // Or cleaner: The user selects "Restore to Source X". We use Source X to inspect the file.
        // But the inspection happens BEFORE selecting target source in the ideal flow?
        // Let's assume the user selects target source FIRST in the UI? Or we just download and peek.

        // Simpler flow for now: Just download to temp and try to detect known formats.

        const tempDir = getTempDir();
        tempFile = path.join(tempDir, path.basename(file));
        const sConf = await resolveAdapterConfig(storageConfig);

        // OPTIMIZATION: Try to read sidecar metadata first. For combined (manifest v2)
        // archives the metadata sidecar points at the archive's index sidecar, which
        // describes every database and directory source without touching the archive - so
        // a listing never costs a multi-gigabyte download.
        let seekableArchiveMeta: BackupMetadata | null = null;

        if (storageAdapter.read) {
            try {
                const metaPath = file + ".meta.json";
                const metaContent = await storageAdapter.read(sConf, metaPath);
                if (metaContent) {
                    const meta = JSON.parse(metaContent);

                    if ((meta as BackupMetadata).archive?.formatVersion === 2) {
                        seekableArchiveMeta = meta as BackupMetadata;
                        const summary = await archiveIndexService.summarize(params.id, file, seekableArchiveMeta);
                        if (summary) return NextResponse.json(summary);
                        // Sidecar missing or unreadable. Deliberately NOT falling through to
                        // the legacy shortcuts below - they only understand databases and
                        // would silently drop this archive's directory sources. The embedded
                        // index is read from the downloaded archive instead.
                    }

                    if (!seekableArchiveMeta && !(meta.combined && meta.combined.directorySources > 0)) {
                        if (meta.databases) {
                             if (Array.isArray(meta.databases.names) && meta.databases.names.length > 0) {
                                  return NextResponse.json({ databases: meta.databases.names });
                             }
                             if (Array.isArray(meta.databases) && meta.databases.length > 0) {
                                  return NextResponse.json({ databases: meta.databases });
                             }
                        }
                        // For multi-DB TAR archives, return the embedded database list
                        if (meta.multiDb?.databases?.length > 0) {
                            return NextResponse.json({ databases: meta.multiDb.databases });
                        }
                        // For server-based adapters (not sqlite) with empty names,
                        // use the source type to signal the frontend that this is a DB restore
                        const serverAdapters = ['mysql', 'mariadb', 'postgres', 'mongodb', 'mssql', 'redis', 'valkey'];
                        if (meta.sourceType && serverAdapters.includes(meta.sourceType.toLowerCase())) {
                            return NextResponse.json({ databases: [], sourceType: meta.sourceType });
                        }
                    }
                }
            } catch (_e) {
                // Fallthrough
            }
        }

        const downloadSuccess = await storageAdapter.download(sConf, file, tempFile);
        if (!downloadSuccess) return NextResponse.json({ error: "Download failed" }, { status: 500 });

        // Seekable (v2) archive whose index sidecar could not be read. Every archive also
        // carries a copy of its index as its last member, so the listing still works - it
        // just costs the download that the sidecar exists to avoid.
        if (seekableArchiveMeta) {
            const summary = await archiveIndexService.summarizeFromArchive(tempFile, seekableArchiveMeta);
            if (summary) return NextResponse.json(summary);
        }

        let databases: string[] = [];

        // Try to find the correct adapter to analyze the file
        // 1. If type is provided (most reliable)
        if (type) {
            const adapter = registry.get(type) as DatabaseAdapter;
            if (adapter && adapter.analyzeDump) {
                databases = await adapter.analyzeDump(tempFile);
            }
        }
        // 2. Fallback: Try all known database adapters (Heuristic)
        else {
            const adapters = ["mysql", "postgres", "mongodb"];
            for (const id of adapters) {
                const adapter = registry.get(id) as DatabaseAdapter;
                if (adapter && adapter.analyzeDump) {
                    const dbs = await adapter.analyzeDump(tempFile);
                    if (dbs.length > 0) {
                        databases = dbs;
                        break;
                    }
                }
            }
        }

        return NextResponse.json({ databases });

    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "Unknown error";
        return NextResponse.json({ error: message }, { status: 500 });
    } finally {
        if (tempFile) {
            await fs.promises.unlink(tempFile).catch(() => {});
        }
    }
}
