import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import type { AdapterConfig, StorageAdapter } from "@/lib/core/interfaces";
import { getTempDir } from "@/lib/temp-dir";
import { READ_NO_FOLLOW } from "@/lib/server/no-follow";
import { assertReadSize, SIDECAR_READ_LIMIT } from "./read-limit";

/** What a `.meta.json` says of the file it lies beside, as far as a reader of these helpers needs it. */
export interface SidecarFields {
    sourceType?: unknown;
    jobId?: unknown;
}

/**
 * The text of a small file of a destination, like a `.meta.json`, null when it is not there.
 *
 * Read through `read()`, which stops at `SIDECAR_READ_LIMIT` and fails with `FileTooLargeError`
 * past it. Only an adapter without `read()` downloads the file to a temp file, which is refused
 * past the same limit. A `read()` that answers null means the file is not there, so it is never
 * tried again as a download, which no limit would bound.
 */
export async function readSidecarText(adapter: StorageAdapter, config: AdapterConfig, remotePath: string): Promise<string | null> {
    if (adapter.read) return adapter.read(config, remotePath, { maxBytes: SIDECAR_READ_LIMIT });
    const local = path.join(getTempDir(), `sidecar-${randomUUID()}.json`);
    try {
        if (!(await adapter.download(config, remotePath, local).catch(() => false))) return null;
        // The download, never a file a link of it points at, see `downloaded-file.ts`.
        const handle = await fs.open(local, READ_NO_FOLLOW);
        try {
            assertReadSize((await handle.stat()).size, SIDECAR_READ_LIMIT);
            return await handle.readFile("utf-8");
        } finally {
            await handle.close();
        }
    } finally {
        await fs.unlink(local).catch(() => undefined);
    }
}

/**
 * The `.meta.json` beside a file of a destination, null without one or when it cannot be read,
 * also when it is larger than any sidecar DBackup writes, see `readSidecarText`.
 */
export async function readSidecar(adapter: StorageAdapter, config: AdapterConfig, file: string): Promise<SidecarFields | null> {
    try {
        const text = await readSidecarText(adapter, config, `${file}.meta.json`);
        return text ? JSON.parse(text) as SidecarFields : null;
    } catch {
        return null;
    }
}
