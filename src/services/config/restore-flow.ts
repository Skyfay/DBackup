/**
 * A configuration restore in two steps: the backup is opened and checked and the person sees what
 * it holds, then Restore starts it. A copy of the database replaces everything and restarts
 * DBackup, a file of an older version is imported as a whole.
 */

import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import prisma from "@/lib/prisma";
import { registerAdapters } from "@/lib/adapters";
import { resolveAdapterConfig } from "@/lib/adapters/config-resolver";
import { registry } from "@/lib/core/registry";
import type { StorageAdapter } from "@/lib/core/interfaces";
import { getTempDir } from "@/lib/temp-dir";
import { ValidationError } from "@/lib/logging/errors";
import type { AppConfigurationBackup, RestorePreview } from "@/lib/types/config-backup";
import type { KeyOverride } from "@/services/backup/key-resolution";
import { inspectDatabaseCopy, isDatabaseCopy, previewOfJson } from "./copy-inspect";
import { importConfiguration } from "./import";
import { openBackupFile } from "./open-backup";
import { holdRestore, peekRestore, takeRestore, type RestoreOwner } from "./pending-restores";
import { stageDatabaseRestore } from "./restore-staging";

export type { RestoreOwner } from "./pending-restores";

export interface ConfigUpload {
    /** The configuration backup itself. */
    backup: File;
    /** The .meta.json beside it, needed for an encrypted file. */
    meta?: File | null;
    /** A key typed into the recovery dialog, as hex. */
    keyHex?: string | null;
    /** A key of the Vault picked in the recovery dialog. */
    profileId?: string | null;
}

/** A backup that is checked and waits for Restore. */
export interface CheckedRestore {
    token: string;
    fileName: string;
    preview: RestorePreview;
}

export type AppliedRestore = { fileName: string } & ({ kind: "database" } | { kind: "json"; notes: string[] });

/** The key the person gave in the recovery dialog, typed or picked from the Vault. */
export function keyOverride(keyHex?: string | null, profileId?: string | null): KeyOverride | undefined {
    if (keyHex) return { rawKeyHex: keyHex };
    return profileId ? { profileId } : undefined;
}

/** Writes an upload to the temp folder. Only its base name is kept, which tells how it is stored. */
async function toTempFile(file: File): Promise<string> {
    const target = path.join(getTempDir(), `upload_restore_${randomUUID()}_${path.basename(file.name)}`);
    await fs.writeFile(target, Buffer.from(await file.arrayBuffer()));
    return target;
}

async function readJson(file: string): Promise<AppConfigurationBackup> {
    try {
        const data = JSON.parse(await fs.readFile(file, "utf8")) as AppConfigurationBackup;
        if (data?.metadata?.version) return data;
    } catch {
        // Told below in words the person can act on.
    }
    throw new ValidationError("The file is no configuration backup of DBackup.");
}

/** Checks an opened backup and holds it for its restore, which then owns the file. */
async function check(plain: string, fileName: string, owner: RestoreOwner): Promise<CheckedRestore> {
    try {
        if (await isDatabaseCopy(plain)) {
            const { preview, keys } = await inspectDatabaseCopy(plain);
            return { token: await holdRestore({ file: plain, fileName, preview, keys, owner }), fileName, preview };
        }
        const preview = previewOfJson(await readJson(plain));
        return { token: await holdRestore({ file: plain, fileName, preview, keys: null, owner }), fileName, preview };
    } catch (error: unknown) {
        await fs.unlink(plain).catch(() => undefined);
        throw error;
    }
}

/** Opens and checks an uploaded configuration backup, which then waits for Restore. */
export async function checkUploadedBackup(upload: ConfigUpload, owner: RestoreOwner): Promise<CheckedRestore> {
    const backupPath = await toTempFile(upload.backup);
    try {
        let meta: Record<string, unknown> | null = null;
        if (upload.meta) {
            try {
                meta = JSON.parse(await upload.meta.text()) as Record<string, unknown>;
            } catch {
                throw new ValidationError("The .meta.json cannot be read.");
            }
        }
        const plain = await openBackupFile(backupPath, meta, keyOverride(upload.keyHex, upload.profileId));
        return await check(plain, path.basename(upload.backup.name), owner);
    } finally {
        await fs.unlink(backupPath).catch(() => undefined);
    }
}

/** The same for a configuration backup at a destination. It is read on the server, so no size limit applies. */
export async function checkStoredBackup(destinationId: string, file: string, override: KeyOverride | undefined, owner: RestoreOwner): Promise<CheckedRestore> {
    registerAdapters();
    const config = await prisma.adapterConfig.findUnique({ where: { id: destinationId } });
    if (!config) throw new ValidationError("The destination no longer exists.");
    const adapter = registry.get(config.adapterId) as StorageAdapter | undefined;
    if (!adapter) throw new ValidationError(`The adapter ${config.adapterId} of the destination is not available.`);
    const resolved = await resolveAdapterConfig(config);

    const local = path.join(getTempDir(), `config_restore_${randomUUID()}_${path.basename(file)}`);
    try {
        await adapter.download(resolved, file, local);
        let meta: Record<string, unknown> | null = null;
        try {
            const text = adapter.read ? await adapter.read(resolved, `${file}.meta.json`) : null;
            meta = text ? (JSON.parse(text) as Record<string, unknown>) : null;
        } catch {
            meta = null;
        }
        const plain = await openBackupFile(local, meta, override);
        return await check(plain, path.basename(file), owner);
    } finally {
        await fs.unlink(local).catch(() => undefined);
    }
}

/**
 * Restores a checked backup. A copy of the database replaces everything and restarts DBackup, so
 * it waits while a backup or restore runs. A file of an older version is imported as a whole and
 * says what it could not bring back.
 */
export async function applyCheckedRestore(token: string, owner: RestoreOwner): Promise<AppliedRestore> {
    const held = await peekRestore(token, owner);
    if (!held) throw new ValidationError("The checked backup is gone, it waits 30 minutes. Pick it again.");
    if (held.preview.kind === "database" && (await prisma.execution.count({ where: { status: "Running" } })) > 0) {
        throw new ValidationError("A backup or restore runs right now, and the restart would stop it. Restore once it has ended.");
    }

    const entry = await takeRestore(token, owner);
    if (!entry) throw new ValidationError("The checked backup is gone, it waits 30 minutes. Pick it again.");
    try {
        if (entry.preview.kind === "database") {
            const actor = owner === "setup" ? null : await prisma.user.findUnique({ where: { id: owner.userId }, select: { name: true } });
            await stageDatabaseRestore(entry.file, entry.keys, { actorName: actor?.name ?? null, fileName: entry.fileName });
            return { kind: "database", fileName: entry.fileName };
        }
        const { notes } = await importConfiguration(await readJson(entry.file), "OVERWRITE");
        return { kind: "json", notes, fileName: entry.fileName };
    } finally {
        await fs.unlink(entry.file).catch(() => undefined);
    }
}

/** A DBackup without any account yet, the only one a restore needs no sign-in on. */
export async function hasNoAccountYet(): Promise<boolean> {
    return (await prisma.user.count()) === 0;
}
