/**
 * Byte sources backed by a storage adapter.
 *
 * Adapters that implement `downloadRange` serve each archive entry with a single ranged
 * request, so restoring one file out of a multi-gigabyte backup transfers only that file.
 *
 * Adapters that don't fall back to downloading the archive once into a temp file and
 * ranging over that. That costs the full transfer, but only once per restore rather than
 * once per file, and it keeps file-level restore working everywhere instead of only on the
 * adapters that happen to support ranges. Callers must always `dispose()` so the temp file
 * is removed.
 */

import fs from "fs/promises";
import crypto from "crypto";
import path from "path";
import prisma from "@/lib/prisma";
import { registry } from "@/lib/core/registry";
import { AdapterConfig as AdapterConfigType, StorageAdapter } from "@/lib/core/interfaces";
import { resolveAdapterConfig } from "@/lib/adapters/config-resolver";
import { getTempDir } from "@/lib/temp-dir";
import { NotFoundError, wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { localFileSource } from "./sources";
import { ArchiveByteSource } from "./types";

const log = logger.child({ module: "archive/storage-source" });

export interface ManagedArchiveSource {
    source: ArchiveByteSource;
    /** True when the adapter served ranges natively, false when the archive was downloaded. */
    ranged: boolean;
    dispose: () => Promise<void>;
}

/** Resolves a storage adapter config row into its implementation and decrypted config. */
export async function resolveStorageAdapter(
    configId: string
): Promise<{ adapter: StorageAdapter; config: AdapterConfigType }> {
    const row = await prisma.adapterConfig.findUnique({ where: { id: configId } });
    if (!row || row.type !== "storage") {
        throw new NotFoundError("Storage adapter", configId);
    }

    const adapter = registry.get(row.adapterId) as StorageAdapter | undefined;
    if (!adapter) {
        throw new NotFoundError("Storage adapter implementation", row.adapterId);
    }

    return { adapter, config: (await resolveAdapterConfig(row)) as AdapterConfigType };
}

/**
 * Opens a byte source over a remote archive.
 *
 * @param adapter - Storage adapter holding the archive
 * @param config - Resolved adapter config
 * @param remotePath - Remote path of the archive
 * @param size - Archive size in bytes, needed to locate the index when no sidecar exists
 */
export async function openStorageArchiveSource(
    adapter: StorageAdapter,
    config: AdapterConfigType,
    remotePath: string,
    size?: number
): Promise<ManagedArchiveSource> {
    const fetchWhole = async (): Promise<{ file: string; source: ArchiveByteSource }> => {
        const tempFile = path.join(getTempDir(), `archive-fetch-${process.pid}-${crypto.randomUUID()}-${path.basename(remotePath)}`);
        const downloaded = await adapter.download(config, remotePath, tempFile);
        if (!downloaded) {
            await fs.unlink(tempFile).catch(() => { });
            throw new Error(`Failed to download archive '${remotePath}' from ${adapter.id}`);
        }
        return { file: tempFile, source: await localFileSource(tempFile) };
    };

    if (adapter.downloadRange) {
        // Declaring the capability is not the same as having it at this moment: an SSH
        // server may have no SFTP subsystem, a token may have expired, a proxy in front of
        // an HTTP destination may refuse Range requests. Rather than failing the restore,
        // the first ranged read that errors falls back to fetching the archive once - the
        // behaviour of an adapter without ranges at all.
        let fallback: { file: string; source: ArchiveByteSource } | null = null;

        return {
            ranged: true,
            source: {
                size,
                read: async (start, end) => {
                    if (fallback) return fallback.source.read(start, end);
                    try {
                        return await adapter.downloadRange!(config, remotePath, start, end);
                    } catch (error: unknown) {
                        log.warn(
                            "Ranged read failed, falling back to fetching the whole archive",
                            { adapter: adapter.id, remotePath },
                            wrapError(error)
                        );
                        fallback = await fetchWhole();
                        return fallback.source.read(start, end);
                    }
                },
            },
            dispose: async () => {
                if (fallback) await fs.unlink(fallback.file).catch(() => { });
            },
        };
    }

    const whole = await fetchWhole();
    return {
        ranged: false,
        source: whole.source,
        dispose: async () => { await fs.unlink(whole.file).catch(() => { }); },
    };
}
