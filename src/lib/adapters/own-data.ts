import path from "path";
import prisma from "@/lib/prisma";
import { decryptConfig } from "@/lib/crypto";
import { ValidationError } from "@/lib/logging/errors";
import { runAsSystem } from "@/lib/tenant/context";
import { HOME_TENANT_ID } from "@/lib/tenant/home";
import { CONFIG_BACKUP_FOLDER } from "@/lib/core/config-backup-path";
import { requestHeaders } from "@/lib/server/request-headers";
import { realExisting } from "@/lib/server/real-path";
import { getTempDir } from "@/lib/temp-dir";
import { hostLocalReason, mssqlUsesLocalFolder } from "@/lib/adapters/host-local";

/**
 * The folders on the server DBackup runs on that hold its own data: the folder of its database, with
 * `dbackup.db`, its copies before a migration and a restore that waits for the next start, the folder
 * of its TLS certificate, its temporary folder (`getTempDir()`), which holds the plain copy of the
 * database the configuration backup uploads and the decrypted copies of a restore, and the folder the
 * configuration backup writes to when its destination is a Local Filesystem. `/proc` counts as well,
 * which shows the keys of DBackup in the environment of its process, and so do the files the keys
 * were read from. The database download and the configuration backup are for a platform admin
 * alone, so a connection that reads or writes one of these folders is too. A path that is one of them,
 * lies inside one or holds one counts, resolved with every symbolic link.
 *
 * Who adds or tries such a connection is checked where the reach of a connection to the server is
 * decided, see `assertOffOwnData`. A run of a job checks it again with `ownDataRefusal` for everyone,
 * since a link can point elsewhere by then and a job may use a connection of the platform admin.
 */

/** What someone reads whose connection reaches the data folder of DBackup. */
export const OWN_DATA_REFUSED = "This path reaches the folder of DBackup's own database, which only a platform admin connects.";
/** What someone reads whose connection reaches the folder of the configuration backup. */
export const CONFIG_BACKUP_FOLDER_REFUSED = "This path reaches the folder of the configuration backup, which only a platform admin connects.";
/** What someone reads whose connection reaches the files of DBackup's process or of its keys. */
export const OWN_SECRETS_REFUSED = "This path reaches the files of DBackup's own process or of its keys, which only a platform admin connects.";
/** What someone reads whose connection reaches the temporary folder of DBackup. */
export const TEMP_FOLDER_REFUSED = "This path reaches DBackup's temporary folder, which holds plain copies of databases and which only a platform admin connects.";
/** What a check reads that could not find out where the configuration backup lies. */
const UNKNOWN_FOLDERS = "Could not check whether this path reaches DBackup's own data. Try again in a moment.";

/** The folder SQL Server shares with DBackup when its config names none, as the adapter reads it. */
const MSSQL_DEFAULT_FOLDER = "/tmp";

/** The local path a connection reads or writes on the server DBackup runs on, null for one that reaches none. */
export function localPathOf(adapterId: string, config: Record<string, unknown>): string | null {
    if (adapterId === "mssql") {
        if (!mssqlUsesLocalFolder(config)) return null;
        const folder = config.localBackupPath;
        return typeof folder === "string" && folder.trim() !== "" ? folder : MSSQL_DEFAULT_FOLDER;
    }
    const value = adapterId === "local-filesystem" ? config.basePath : adapterId === "sqlite" && config.mode !== "ssh" ? config.path : undefined;
    return typeof value === "string" && value.trim() !== "" ? value : null;
}

/**
 * Adapters that only ever read and write files with a name they made up in their local folder, with
 * a random part, and delete them again. SQL Server stages its `.bak` files like that, in `/tmp` by
 * default, so the temporary folder of DBackup does not count for it.
 */
const OWN_NAMES_ONLY: ReadonlySet<string> = new Set(["mssql"]);

/** The database file of `DATABASE_URL`, a relative one against the folder of schema.prisma, as Prisma resolves it. */
function databaseFolder(): string | null {
    const url = process.env.DATABASE_URL ?? "";
    if (!url.startsWith("file:")) return null;
    const file = url.slice("file:".length).split("?")[0];
    return path.dirname(path.isAbsolute(file) ? file : path.resolve(process.cwd(), "prisma", file));
}

/**
 * A path with every link of it resolved as far as it exists, the rest walked part by part like the
 * Local Filesystem adapter does, so a link that does not lead anywhere yet still counts where a write
 * through it lands. A path through a loop of links, or a link that cannot be read, leads nowhere a
 * write could land and no adapter follows it either, so it stays as written.
 */
async function realPath(target: string): Promise<string> {
    return realExisting(target).catch(() => path.resolve(target));
}

/** Whether `child` is `parent` or lies inside it. */
function within(child: string, parent: string): boolean {
    const relative = path.relative(parent, child);
    return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

/** Whether a path is a folder, lies inside it or holds it. */
const reaches = (candidate: string, folder: string) => within(candidate, folder) || within(folder, candidate);

interface OwnFolder {
    kind: "data" | "secrets" | "temp" | "config-backup";
    /** The folder as written and with its links resolved, so a link to it or from it counts too. */
    paths: string[];
    /** The destination of the configuration backup, which writes into its own folder. */
    storageId?: string;
}

/** The folder the configuration backup writes to, when its destination is a Local Filesystem of the home tenant. */
async function configBackupFolder(): Promise<{ storageId: string; folder: string } | null> {
    return runAsSystem(async () => {
        const setting = await prisma.systemSetting.findUnique({ where: { key: "config.backup.storageId" }, select: { value: true } });
        if (!setting?.value) return null;
        const row = await prisma.adapterConfig.findFirst({ where: { id: setting.value, tenantId: HOME_TENANT_ID }, select: { adapterId: true, config: true } });
        if (!row || row.adapterId !== "local-filesystem") return null;
        const basePath = localPathOf(row.adapterId, decryptConfig(JSON.parse(row.config)) as Record<string, unknown>);
        return basePath ? { storageId: setting.value, folder: path.join(path.resolve(basePath), CONFIG_BACKUP_FOLDER) } : null;
    });
}

/**
 * What the process of DBackup itself shows: `/proc`, whose `self/environ` holds `ENCRYPTION_KEY` and
 * `BETTER_AUTH_SECRET`, and the files those were read from, named by `ENCRYPTION_KEY_FILE` and
 * `BETTER_AUTH_SECRET_FILE`.
 */
function secretPaths(): string[] {
    const files = [process.env.ENCRYPTION_KEY_FILE, process.env.BETTER_AUTH_SECRET_FILE].filter((file): file is string => !!file && file.trim() !== "");
    return ["/proc", ...files];
}

async function ownFolders(): Promise<OwnFolder[]> {
    const data = [databaseFolder(), process.env.CERTS_DIR || "/data/certs"].filter((folder): folder is string => !!folder);
    const folders: OwnFolder[] = await Promise.all(data.map(async (folder) => ({ kind: "data" as const, paths: [path.resolve(folder), await realPath(folder)] })));
    for (const secret of secretPaths()) folders.push({ kind: "secrets", paths: [path.resolve(secret), await realPath(secret)] });
    const temp = getTempDir();
    folders.push({ kind: "temp", paths: [path.resolve(temp), await realPath(temp)] });
    const config = await configBackupFolder();
    if (config) folders.push({ kind: "config-backup", storageId: config.storageId, paths: [config.folder, await realPath(config.folder)] });
    return folders;
}

/** The sentence that refuses a path, by the kind of folder it reaches. */
const REFUSAL_OF: Record<OwnFolder["kind"], string> = {
    data: OWN_DATA_REFUSED,
    secrets: OWN_SECRETS_REFUSED,
    temp: TEMP_FOLDER_REFUSED,
    "config-backup": CONFIG_BACKUP_FOLDER_REFUSED,
};

export interface OwnDataOptions {
    /** The saved connection, which may be the destination of the configuration backup and write into its folder. */
    configId?: string | null;
    /** A folder inside the connection, like the one a directory source of a job reads. */
    subPath?: string;
}

/**
 * Why a connection reaches the own data of DBackup, as the sentence that refuses it, or null when it
 * does not or reaches no local path. The destination of the configuration backup itself writes into
 * the folder of the configuration backup, so only its data folders count for it.
 */
export async function ownDataRefusal(adapterId: string, config: Record<string, unknown>, options: OwnDataOptions = {}): Promise<string | null> {
    const base = localPathOf(adapterId, config);
    if (!base) return null;
    const target = options.subPath ? path.join(path.resolve(base), options.subPath.replace(/^[/\\]+/, "")) : base;
    let folders: OwnFolder[];
    try {
        folders = await ownFolders();
    } catch {
        // Without the folders nothing says the path is safe, so it waits for a check that works.
        return UNKNOWN_FOLDERS;
    }
    const candidates = [path.resolve(target), await realPath(target)];
    for (const folder of folders) {
        if (folder.kind === "config-backup" && options.configId && options.configId === folder.storageId) continue;
        if (folder.kind === "temp" && OWN_NAMES_ONLY.has(adapterId)) continue;
        if (candidates.some((candidate) => folder.paths.some((own) => reaches(candidate, own)))) {
            return REFUSAL_OF[folder.kind];
        }
    }
    return null;
}

/** What someone reads whose Docker volume holds DBackup's own data. */
export const OWN_VOLUME_REFUSED = "DBackup's own container keeps its database, its certificates, its temporary files or its configuration backups in this volume, so no run reads it through Docker Volumes without SSH.";
/** What a run reads that could not find out whether a Docker volume holds DBackup's own data. */
export const OWN_VOLUME_UNKNOWN = "DBackup runs in a container this Docker host does not list, so it cannot tell whether this volume holds its own data and does not read it through Docker Volumes without SSH. Connect to the Docker host over SSH instead.";
/** What a run reads whose Docker host did not say which volumes DBackup's own container mounts. */
const OWN_VOLUME_UNKNOWN_DOCKER = "Docker did not answer which volumes DBackup's own container holds, so this volume is not read through Docker Volumes without SSH. Try again once Docker answers.";

/**
 * Why a Docker Volumes connection without SSH may not read or write a volume, or null when it may.
 * Such a connection reaches the Docker of the server DBackup runs on, so a volume that DBackup's
 * own container mounts at the folder of its database, its TLS certificate, its temporary folder or
 * the folder of the configuration backup holds the same files a Local Filesystem there would reach.
 * The container is found by its id, see `own-container.ts`. In a container this Docker host does
 * not list, nothing says a volume is safe, so it is refused. Outside of any container a volume
 * counts whose folder on the server reaches one of them. A volume Docker created with the bind
 * options of the local driver hides the folder it really uses, which only an admin of the Docker
 * host sets up.
 *
 * @param volume The volume, the first part of the path of the source or target, every volume when empty.
 */
export async function ownVolumeRefusal(adapterId: string, config: Record<string, unknown>, volume: string): Promise<string | null> {
    // Docker over SSH reaches another server, whose volumes hold nothing of DBackup.
    if (adapterId !== "docker-volume" || !hostLocalReason(adapterId, config)) return null;
    const name = volume.replace(/\\/g, "/").split("/").find((part) => part !== "" && part !== ".") ?? "";
    let folders: OwnFolder[];
    try {
        folders = await ownFolders();
    } catch {
        return UNKNOWN_FOLDERS;
    }
    // Loaded here, so the checks of a local path never load the Docker client.
    const { connectDocker } = await import("@/lib/adapters/storage/docker/engine/connect");
    const { findOwnContainer, ownContainerHints } = await import("@/lib/adapters/storage/docker/own-container");
    const hints = await ownContainerHints();
    const connection = connectDocker(config);
    try {
        if (hints.inContainer) {
            const own = findOwnContainer(await connection.engine.listContainers(), hints);
            if (!own) return OWN_VOLUME_UNKNOWN;
            const held = own.mounts.filter((mount) => mount.type === "volume" && mount.volume
                && folders.some((folder) => folder.paths.some((folderPath) => reaches(folderPath, mount.destination))));
            return held.some((mount) => name === "" || mount.volume === name) ? OWN_VOLUME_REFUSED : null;
        }
        const volumes = name === "" ? await connection.engine.listVolumes() : [await connection.engine.inspectVolume(name)];
        for (const found of volumes) {
            if (!found?.mountpoint) continue;
            const candidates = [path.resolve(found.mountpoint), await realPath(found.mountpoint)];
            if (candidates.some((candidate) => folders.some((folder) => folder.paths.some((own) => reaches(candidate, own))))) return OWN_VOLUME_REFUSED;
        }
        return null;
    } catch {
        // Without the answer of Docker nothing says the volume is safe, and the run would fail on it anyway.
        return OWN_VOLUME_UNKNOWN_DOCKER;
    } finally {
        await connection.close().catch(() => undefined);
    }
}

/** `scanRefusal` for a saved connection, its config as stored. Null for one that cannot be read, whose listing fails on its own. */
export async function storedScanRefusal(row: { id: string; adapterId: string; config: string }): Promise<string | null> {
    let config: Record<string, unknown>;
    try {
        config = decryptConfig(JSON.parse(row.config)) as Record<string, unknown>;
    } catch {
        return null;
    }
    return scanRefusal(row.adapterId, config, row.id);
}

/** The destination the configuration backup writes to, null without one. */
async function configBackupStorageId(): Promise<string | null> {
    return runAsSystem(async () => {
        const setting = await prisma.systemSetting.findUnique({ where: { key: "config.backup.storageId" }, select: { value: true } });
        return setting?.value || null;
    });
}

/**
 * Why a task that goes through every destination, like the storage stats, the warmup of the cache
 * or the integrity check, leaves this one out, or null when it lists it. A destination whose folder
 * reaches the own data of DBackup is left out, since its listing would show the files of DBackup to
 * the members of its tenant, unless it is the destination of the configuration backup itself.
 */
export async function scanRefusal(adapterId: string, config: Record<string, unknown>, configId: string): Promise<string | null> {
    if (!localPathOf(adapterId, config)) return null;
    const refusal = await ownDataRefusal(adapterId, config, { configId });
    if (!refusal) return null;
    try {
        return (await configBackupStorageId()) === configId ? null : refusal;
    } catch {
        return UNKNOWN_FOLDERS;
    }
}

/**
 * Whether the code that runs now may reach the own data of DBackup: a platform admin signed in with
 * a session, like the database download and the configuration backup, and code outside a request,
 * like the scheduler, a run of a job or the start of the server, which checks a run on its own.
 */
export async function mayReachOwnData(): Promise<boolean> {
    let headers: Headers;
    try {
        headers = await requestHeaders();
    } catch {
        return true;
    }
    // Loaded here like in `tenant/current.ts`, the access control reads the database itself.
    const { getAuthContext } = await import("@/lib/auth/access-control");
    const ctx = await getAuthContext(headers).catch(() => null);
    return !!ctx && ctx.isPlatformAdmin && ctx.authMethod === "session";
}

/**
 * Refuses a connection that reaches the own data of DBackup, see `ownDataRefusal`, to anyone who is
 * no platform admin with a session. Every way to add, change, try or open a connection asks it.
 *
 * @throws ValidationError saying which folder the path reaches.
 */
export async function assertOffOwnData(adapterId: string, config: Record<string, unknown>, options: OwnDataOptions = {}): Promise<void> {
    if (!localPathOf(adapterId, config)) return;
    const refusal = await ownDataRefusal(adapterId, config, options);
    if (refusal && !(await mayReachOwnData())) throw new ValidationError(refusal, { field: "config" });
}
