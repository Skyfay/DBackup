import type { AuthContext } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import prisma from "@/lib/prisma";
import { decryptConfig } from "@/lib/crypto";
import { PermissionError, ValidationError } from "@/lib/logging/errors";
import { hostLocalReason } from "@/lib/adapters/host-local";
import { ownVolumeRefusal } from "@/lib/adapters/own-data";
import { assertRestoreFolder } from "@/lib/archive/remote-paths";
import { CONFIG_BACKUP_FILE_PREFIX, isConfigBackupSegment } from "@/lib/core/config-backup-path";
import { METADATA_SIDECAR_SUFFIX, SIDECAR_SUFFIXES } from "@/lib/core/backup-files";
import { configBackupTargetRefusal } from "@/lib/server/config-backup-target-guard";
import { runAsSystem } from "@/lib/tenant/context";
import { HOME_TENANT_ID } from "@/lib/tenant/home";
import { providedIds } from "@/services/sharing/provided";
import type { RestoreInput } from "./types";

/**
 * Who starts a restore, as far as the targets it may write into depend on it. The tenant, All
 * tenants and the permissions come along from the request, and a caller without them may only do
 * what needs none of them.
 */
export type RestoreCaller = Pick<AuthContext, "isPlatformAdmin" | "authMethod"> & {
    tenantId?: string | null;
    allTenants?: boolean;
    permissions?: readonly string[];
};

/**
 * The caller of a restore a customer starts of a database of a shared server. Whoever starts it,
 * it writes as a customer, so it never writes into what the configuration backup goes through.
 */
export const CUSTOMER_RESTORE_CALLER: RestoreCaller = { isPlatformAdmin: false, authMethod: "session" };

/**
 * Every connection a restore names to write into: the database server and the storage of every
 * directory mapping, picked or not, since the restore opens the target of the first mapping of a
 * directory source.
 */
export function restoreTargetIds(input: Pick<RestoreInput, "targetSourceId" | "directoryMapping">): string[] {
    const ids = [
        input.targetSourceId,
        ...(input.directoryMapping ?? []).map((mapping) => mapping.targetConfigId),
    ];
    return [...new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0))];
}

/**
 * Refuses a restore that names a connection to write into that is neither of the caller's tenant nor
 * provided to it, before anything else reads that connection, so no other check answers for a
 * connection of another tenant. It reads as one that does not exist, in the words the restore uses
 * for that further on, see `preflightRestore`. A customer's restore of a shared database writes
 * into the server the service checked, see `restoreShared`, and names nothing else.
 */
async function assertTargetsInTenant(input: Pick<RestoreInput, "targetSourceId" | "directoryMapping" | "shared">, caller: RestoreCaller): Promise<void> {
    const named = [
        ...(input.shared || !input.targetSourceId ? [] : [{ id: input.targetSourceId, missing: "Target source not found" }]),
        ...(input.directoryMapping ?? []).flatMap((mapping) => (mapping.targetConfigId
            ? [{ id: mapping.targetConfigId, missing: `Invalid restore target for a directory entry: adapter '${mapping.targetConfigId}' not found` }]
            : [])),
    ];
    for (const target of named) {
        const row = await runAsSystem(() => prisma.adapterConfig.findUnique({ where: { id: target.id }, select: { id: true, tenantId: true } }));
        // A connection that is gone fails the restore further on, with the same words.
        if (!row || row.tenantId === caller.tenantId) continue;
        if (!caller.tenantId || !(await providedIds(caller.tenantId, [row.id])).has(row.id)) throw new Error(target.missing);
    }
}

/**
 * Refuses a restore that would write into the destination of the configuration backup for anyone
 * who is no platform admin with a session, the same as the file restore does with `checkTargets`.
 * Restored files there change what the configuration backup holds and where it reads it from. The
 * directory mappings go through `assertWriteTargets` as well. First of all every connection it
 * names has to be of the caller's tenant or provided to it, see `assertTargetsInTenant`.
 *
 * @throws Error as for a connection that does not exist for one of another tenant, PermissionError with the sentence of the lock, ValidationError for a folder that leaves its connection.
 */
export async function assertRestoreTargetsAllowed(input: Pick<RestoreInput, "targetSourceId" | "directoryMapping" | "shared">, caller: RestoreCaller): Promise<void> {
    await assertTargetsInTenant(input, caller);
    const message = await configBackupTargetRefusal(caller, { connectionIds: restoreTargetIds(input) });
    if (message) throw new PermissionError("platform admin", { message });
    await assertWriteTargets(await mappingTargets(input.directoryMapping ?? []), caller);
}

/** Where the files of one directory source go, as far as who may write there depends on it. */
export interface WriteTarget {
    /** The saved connection the files go to. */
    connectionId: string;
    adapterId: string;
    /** The tenant of the connection. */
    tenantId: string;
    /** Its config with its saved logins, as the restore uses it. */
    config: Record<string, unknown>;
    /** The folder inside the connection, for Docker Volumes the volume first. */
    basePath: string;
    /** Whether the files go back to the volume or folder the directory source read them from. */
    origin: boolean;
}

/** What someone reads whose restore would write into the Docker of the server DBackup runs on. */
export const HOST_DOCKER_RESTORE_REFUSED = "A restore into Docker Volumes without SSH empties and overwrites volumes of the Docker of the server DBackup runs on, which only a platform admin does.";

/** What someone reads whose restore would write into another volume than the backup read. */
export const OTHER_VOLUME_REFUSED = "A restore into another Docker volume than the one the backup read needs the right to change the Docker connection.";

/**
 * What someone reads whose restore into Docker Volumes names no volume, a base path of `/` or
 * nothing. The first part of every path of the archive would then pick the volume, so a backup
 * could name any volume of the host, the one DBackup keeps its own data in too, which the checks
 * of the volume the request names never saw.
 */
export const NO_VOLUME_REFUSED = "A restore into Docker Volumes needs the volume it writes into. Pick a volume as the target.";

/** What someone reads whose restore would write anywhere else than the folder the backup read. */
export const OTHER_TARGET_REFUSED = "A restore into another place than the folder the backup read needs the right to change the connection it writes into.";

/**
 * Whether the caller may write where only a platform admin goes on the server DBackup runs on: a
 * platform admin with a session who works in the home tenant, as `mayReachHost` decides for a request.
 */
export function callerReachesHost(caller: RestoreCaller): boolean {
    return caller.isPlatformAdmin && caller.authMethod === "session" && !caller.allTenants && caller.tenantId === HOME_TENANT_ID;
}

/**
 * Whether the caller may change the connection, as an edit of it asks: `destinations:write` in the
 * tenant of the connection, and for one that reaches the server DBackup runs on a platform admin
 * with a session in the home tenant, see `mayReachHost`.
 */
function managesConnection(caller: RestoreCaller, target: WriteTarget): boolean {
    if (hostLocalReason(target.adapterId, target.config)) return callerReachesHost(caller);
    if (caller.isPlatformAdmin) return true;
    return caller.tenantId === target.tenantId && !!caller.permissions?.includes(PERMISSIONS.DESTINATIONS.WRITE);
}

/**
 * Why the caller may not write into a target, or null when it may:
 *
 * - A folder that leaves the connection, see `assertRestoreFolder`.
 * - A folder called `config-backups`, which only a platform admin writes, see `restoredFileRefusal`.
 * - Docker Volumes with no volume in the base path, `NO_VOLUME_REFUSED`, for everyone.
 * - Docker Volumes without SSH reach the Docker of the server DBackup runs on, and a restore empties
 *   each volume it writes into and lays the modes and owners of the archive on it, so only a platform
 *   admin does that, see `callerReachesHost`.
 * - Every connection takes back the folder the backup read, Docker Volumes over SSH its volume, and
 *   anything else only from someone who may change the connection. A restore overwrites what lies
 *   there, like the backups of other jobs at a destination or another volume on the same host, which
 *   the right to restore files never covers.
 */
export function writeTargetRefusal(target: WriteTarget, caller: RestoreCaller): string | null {
    try {
        assertRestoreFolder(target.basePath);
    } catch (error: unknown) {
        return error instanceof Error ? error.message : String(error);
    }
    if (!writesConfigBackupFiles(caller) && partsOf(target.basePath).some(isConfigBackupSegment)) return CONFIG_BACKUP_PATH_REFUSED;
    const docker = target.adapterId === "docker-volume";
    if (docker && volumeOf(target.basePath) === "") return NO_VOLUME_REFUSED;
    if (docker && hostLocalReason(target.adapterId, target.config)) return callerReachesHost(caller) ? null : HOST_DOCKER_RESTORE_REFUSED;
    if (target.origin || managesConnection(caller, target)) return null;
    return docker ? OTHER_VOLUME_REFUSED : OTHER_TARGET_REFUSED;
}

/**
 * Refuses a restore whose files would go where the caller may not write, see `writeTargetRefusal`,
 * before anything is written. A volume of Docker Volumes without SSH that DBackup's own container
 * keeps its data in is refused to everyone, a platform admin too, like a run refuses to read it,
 * since a restore empties the volume and lays the files of the archive into it, see `ownVolumeRefusal`.
 *
 * @throws ValidationError for a folder that leaves its connection or a volume of DBackup itself, PermissionError for a volume.
 */
export async function assertWriteTargets(targets: WriteTarget[], caller: RestoreCaller): Promise<void> {
    for (const target of targets) {
        const message = writeTargetRefusal(target, caller);
        if (!message) {
            const own = await ownVolumeRefusal(target.adapterId, target.config, target.basePath);
            if (own) throw new ValidationError(own, { field: "targetPath" });
            continue;
        }
        if (message === HOST_DOCKER_RESTORE_REFUSED || message === OTHER_VOLUME_REFUSED || message === OTHER_TARGET_REFUSED || message === CONFIG_BACKUP_PATH_REFUSED) {
            throw new PermissionError("platform admin", { message });
        }
        throw new ValidationError(message, { field: "targetPath" });
    }
}

/** The volume a path inside Docker Volumes names, its first part. */
export function volumeOf(remotePath: string): string {
    return remotePath.replace(/\\/g, "/").split("/").find((part) => part !== "" && part !== ".") ?? "";
}

/**
 * Whether a target is the place a directory source read its files from: its connection, and for
 * Docker Volumes the volume the source names as its path, for any other connection the folder of
 * the source or one inside it.
 */
export function isOrigin(source: { configId: string; path: string } | null, connectionId: string, basePath: string, adapterId: string): boolean {
    if (!source || source.configId !== connectionId) return false;
    if (adapterId === "docker-volume") {
        const volume = volumeOf(source.path);
        return volume !== "" && volume === volumeOf(basePath);
    }
    const folder = partsOf(source.path);
    const target = partsOf(basePath);
    return folder.length <= target.length && folder.every((part, index) => part === target[index]);
}

/** What someone reads whose full restore names no folder for a directory source it restores. */
export const NO_RESTORE_FOLDER = "Pick the folder each restored directory source goes into.";

/**
 * The folder a directory mapping of a full restore writes into, null without one. The check of the
 * targets and the restore itself read it here, so they never write and check two places, and an
 * empty folder is refused rather than taken from the archive, whose label is no path anyone checked.
 */
export function mappingFolder(mapping: { targetPath?: string | null }): string | null {
    const folder = typeof mapping.targetPath === "string" ? mapping.targetPath : "";
    return folder.trim() === "" ? null : folder;
}

/** The targets of the directory mappings of a full restore, read for every tenant, as their ids name them. */
async function mappingTargets(mappings: NonNullable<RestoreInput["directoryMapping"]>): Promise<WriteTarget[]> {
    const targets: WriteTarget[] = [];
    for (const mapping of mappings) {
        if (!mapping.targetConfigId) continue;
        const folder = mappingFolder(mapping);
        if (folder === null) {
            // A source left out writes nothing, a picked one without a folder is refused.
            if (mapping.selected) throw new ValidationError(NO_RESTORE_FOLDER, { field: "targetPath" });
            continue;
        }
        const basePath = folder;
        const row = await runAsSystem(() => prisma.adapterConfig.findUnique({
            where: { id: mapping.targetConfigId },
            select: { id: true, adapterId: true, tenantId: true, config: true },
        }));
        if (!row) {
            // A row that is gone fails the restore on its own, the folder is still checked.
            targets.push({ connectionId: mapping.targetConfigId, adapterId: "", tenantId: "", config: {}, basePath, origin: false });
            continue;
        }
        let config: Record<string, unknown> = {};
        try {
            config = decryptConfig(JSON.parse(row.config)) as Record<string, unknown>;
        } catch {
            // A config that cannot be read counts as one of the server DBackup runs on, the stricter way.
        }
        const source = await runAsSystem(() => prisma.jobSource.findUnique({ where: { id: mapping.entryId }, select: { configId: true, path: true } }));
        targets.push({ connectionId: row.id, adapterId: row.adapterId, tenantId: row.tenantId, config, basePath, origin: isOrigin(source, row.id, basePath, row.adapterId) });
    }
    return targets;
}

/** Whether the caller writes the files of the configuration backup and sidecars: a platform admin with a session, like `readsConfigBackups`. */
function writesConfigBackupFiles(caller: RestoreCaller | undefined): boolean {
    return !!caller?.isPlatformAdmin && caller.authMethod === "session";
}

/** The parts of a path, with either slash, without empty parts and `.`. */
const partsOf = (remotePath: string) => remotePath.replace(/\\/g, "/").split("/").filter((part) => part !== "" && part !== ".");

/** What someone reads whose restore would write into the folder or under a name of the configuration backup. */
export const CONFIG_BACKUP_PATH_REFUSED = "Restored files never go into a config-backups folder or under the name of a file of the configuration backup, unless a platform admin restores them.";

/** What someone reads whose restore would write a `.meta.json`, which decides how the backup beside it is read. */
export const SIDECAR_REFUSED = "A .meta.json decides how DBackup reads, keeps and locks the backup beside it, so only a platform admin restores one into a storage. Download it instead.";

/** What someone reads whose restore would write a name with a `:` into an SMB share. */
export const SMB_STREAM_REFUSED = "An SMB share reads a colon in a name as an alternate data stream of another file, so a file with one in its path is not restored there. Download it instead.";

/** What someone reads whose restore would write a file named like a backup or its index. */
export const BACKUP_FILE_REFUSED = "A file named like a backup of DBackup or its index (.tar, .enc, .index) would replace or sit beside a backup, so only a platform admin restores one into a storage. Download it instead.";

/**
 * The endings of the files a backup writes besides its `.meta.json`: the archive (`.tar`), an
 * encrypted backup of an older version, which ends in `.enc` like the configuration backup, and the
 * index of an archive, see `SIDECAR_SUFFIXES`.
 */
const BACKUP_FILE_ENDINGS = [".tar", ".enc", ...SIDECAR_SUFFIXES.filter((suffix) => suffix !== METADATA_SIDECAR_SUFFIX)];

/** What someone reads whose restore would write a name with a short name part of Windows into an SMB share. */
export const SMB_SHORT_NAME_REFUSED = "An SMB share reads a name part like CONFIG~1 as the short name of another file or folder, so a file with one in its path is only restored there by a platform admin. Download it instead.";

/** A part of a path with a `~` and a digit, how Windows writes the short 8.3 name of a long one. */
const SHORT_NAME = /~\d/;

/**
 * A name as a storage that ignores the case compares it, in lower case, and in lower case of its
 * upper case, since a letter like `ſ` or `ı` turns into `S` or `I` only that way. The names it is
 * compared with are all lower case.
 */
function foldedForms(name: string): string[] {
    return [...new Set([name.toLowerCase(), name.toUpperCase().toLowerCase()])];
}

/**
 * Why a restored file may not be written at this path of its connection, or null when it may. A
 * file in a folder called `config-backups`, at any depth since a second connection to the same place
 * may start higher up, or named like a file of the configuration backup reads as one there, which a
 * platform admin may then restore as the whole database. A `.meta.json` decides how DBackup reads the
 * backup beside it, whether retention keeps it, whether it is locked and whether it counts as a
 * configuration backup. A file named like a backup or its index replaces a backup of another job,
 * also a locked one, without the right to delete backups, or reads as a backup there, which matters
 * only on a backup destination (`intoDestination`), never in a folder a job backs up. Only a
 * platform admin with a session writes any of these, like `readsConfigBackups`.
 *
 * Windows reads a `:` in a name as the start of an alternate data stream, so `x.meta.json::$DATA`
 * writes the file `x.meta.json` and `config-backups:$I30:$INDEX_ALLOCATION` is that folder. Each
 * name is therefore compared up to its first `:`, and an SMB share, where any name with a `:`
 * lands in a stream of another file, takes none for anyone. Names compare without case, as storages
 * on Windows and macOS and SMB shares read them, and on an SMB share a part like `CONFIG~1` may be
 * the short name of `config-backups`, so such a part goes there only from a platform admin.
 *
 * @param adapterId The adapter of the connection the file goes to, when known.
 */
export function restoredFileRefusal(remotePath: string, caller: RestoreCaller | undefined, intoDestination = true, adapterId?: string): string | null {
    if (adapterId === "smb" && remotePath.includes(":")) return SMB_STREAM_REFUSED;
    if (writesConfigBackupFiles(caller)) return null;
    // A name as Windows reads it, without the stream after its first `:`.
    const parts = partsOf(remotePath).map((part) => part.split(":")[0]);
    // Windows gives a long name a short one like `CONFIG~1`, which reaches the same folder or file.
    if (adapterId === "smb" && parts.some((part) => SHORT_NAME.test(part))) return SMB_SHORT_NAME_REFUSED;
    if (parts.some(isConfigBackupSegment)) return CONFIG_BACKUP_PATH_REFUSED;
    // Windows drops dots and spaces at the end of a name, so `x.meta.json.` is that file there too.
    const forms = foldedForms((parts[parts.length - 1] ?? "").replace(/[. ]+$/, ""));
    if (forms.some((form) => form.startsWith(CONFIG_BACKUP_FILE_PREFIX))) return CONFIG_BACKUP_PATH_REFUSED;
    if (forms.some((form) => form.endsWith(METADATA_SIDECAR_SUFFIX))) return SIDECAR_REFUSED;
    // A file named like a backup or its index replaces one of another job, locked or not, or reads as
    // one, which only a storage that holds backups does. Into a folder source it is a file like any other.
    if (intoDestination && BACKUP_FILE_ENDINGS.some((ending) => forms.some((form) => form.endsWith(ending)))) return BACKUP_FILE_REFUSED;
    return null;
}
