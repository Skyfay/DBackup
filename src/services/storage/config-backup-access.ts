import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import type { AdapterConfig, StorageAdapter } from "@/lib/core/interfaces";
import { isConfigBackupPath } from "@/lib/core/config-backup-path";
import { getTempDir } from "@/lib/temp-dir";
import { openDestination } from "@/services/sharing/destination-access";

/**
 * Whether a file of a destination is a configuration backup, a copy of the whole DBackup database
 * with the keys of every login. Its sidecar says `sourceType: "SYSTEM"`, and the configuration backup
 * writes it to `config-backups/` at the root of a destination of the home tenant. A file in the
 * folder of a customer on a shared destination is never one by its path, since the configuration
 * backup never writes there, so only its sidecar counts.
 *
 * Read as `tenantId` sees the destination, the tenant of the request when it is left out. A
 * destination that cannot be opened leaves the path to decide, its download fails anyway.
 */
export async function isConfigBackupFile(storageId: string, file: string, tenantId?: string | null): Promise<boolean> {
    let opened: Awaited<ReturnType<typeof openDestination>>;
    try {
        opened = await openDestination(storageId, tenantId);
    } catch {
        return isConfigBackupPath(file);
    }
    if (opened.mode.kind !== "customer" && isConfigBackupPath(file)) return true;
    return (await sidecarOf(opened.adapter, opened.config, file))?.sourceType === "SYSTEM";
}

/** The `.meta.json` beside a file, null without one or when it cannot be read. */
async function sidecarOf(adapter: StorageAdapter, config: AdapterConfig, file: string): Promise<{ sourceType?: unknown } | null> {
    const remote = `${file}.meta.json`;
    try {
        if (adapter.read) {
            const text = await adapter.read(config, remote);
            if (text) return JSON.parse(text) as { sourceType?: unknown };
        }
    } catch { /* a download below tries again */ }
    const local = path.join(getTempDir(), `config-check-${randomUUID()}.json`);
    try {
        if (!(await adapter.download(config, remote, local))) return null;
        return JSON.parse(await fs.readFile(local, "utf-8")) as { sourceType?: unknown };
    } catch {
        return null;
    } finally {
        await fs.unlink(local).catch(() => undefined);
    }
}
