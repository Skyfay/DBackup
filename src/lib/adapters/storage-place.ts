import { urlHost } from "./dialed-hosts";

/**
 * Where a storage connection keeps its files, as plain data: the storage it names (a server, a
 * bucket, a share, an account of a cloud drive) and the folder in it. Two connections overlap when
 * they name the same storage and the folder of one lies inside the folder of the other, or both are
 * the same. A destination shared with customers keeps their backups under `tenants/<id>/` of its
 * folder, so no other connection of its tenant may overlap it, see `shared-place.ts`.
 *
 * It compares the address as typed, lowercased where the protocol ignores case. A name and its IP
 * address, or two ports of one server, count as two storages. The folder of Google Drive is an id,
 * so a folder inside another one is not found there, only the same folder and the top of the drive.
 */

type Config = Record<string, unknown>;

export interface StoragePlace {
    /** The storage, like `ssh:nas.example.com` or `s3:s3.example.com:backups`. */
    storage: string;
    /** The folder in it, one entry per level, empty for its top. */
    folder: string[];
}

const text = (value: unknown) => (typeof value === "string" || typeof value === "number" ? String(value).trim() : "");

/** The levels of a path, with `.` dropped and `..` taken back, so `a/./b/../c` is `a/c`. */
function levelsOf(...paths: unknown[]): string[] {
    const levels: string[] = [];
    for (const part of paths.flatMap((path) => text(path).split(/[/\\]+/))) {
        if (!part || part === ".") continue;
        if (part === "..") levels.pop();
        else levels.push(part);
    }
    return levels;
}

/** A folder relative to the login of an SSH or FTP account starts in its home, which depends on the account. */
function accountFolder(config: Config, path: unknown): string[] {
    const relative = !text(path).startsWith("/");
    const user = text(config.username) || text(config.user);
    return relative ? [`~${user}`, ...levelsOf(path)] : levelsOf(path);
}

/** The S3 storage of a bucket: the endpoint, any of Amazon's for Amazon S3, which keeps bucket names unique worldwide. */
function s3Storage(endpoint: string | null, bucket: unknown): string | null {
    const name = text(bucket);
    if (!endpoint || !name) return null;
    const host = endpoint.toLowerCase();
    return `s3:${host === "amazonaws.com" || host.endsWith(".amazonaws.com") ? "aws" : host}:${name}`;
}

function s3Place(endpoint: string | null, config: Config): StoragePlace | null {
    const storage = s3Storage(endpoint, config.bucket);
    return storage ? { storage, folder: levelsOf(config.pathPrefix) } : null;
}

/** The server and share of an SMB address, `//server/share/sub`, and the levels after the share. */
function smbPlace(config: Config): StoragePlace | null {
    const levels = levelsOf(config.address).map((level) => level.toLowerCase());
    if (levels.length < 2) return null;
    return { storage: `smb:${levels[0]}/${levels[1]}`, folder: [...levels.slice(2), ...levelsOf(config.pathPrefix).map((level) => level.toLowerCase())] };
}

function webdavPlace(config: Config): StoragePlace | null {
    try {
        const url = new URL(text(config.url));
        return { storage: `dav:${url.host.toLowerCase()}`, folder: [...levelsOf(decodeURIComponent(url.pathname)), ...levelsOf(config.pathPrefix)] };
    } catch {
        return null;
    }
}

/** A cloud drive is the account of an app, which DBackup knows by the id of the app alone. */
function drivePlace(kind: string, config: Config, folder: string[]): StoragePlace | null {
    const app = text(config.clientId);
    return app ? { storage: `${kind}:${app}`, folder } : null;
}

const PLACES: Readonly<Record<string, (config: Config) => StoragePlace | null>> = {
    "local-filesystem": (config) => ({ storage: "file:", folder: levelsOf(config.basePath) }),
    // SFTP and rsync reach the same files of a server over SSH.
    sftp: (config) => (text(config.host) ? { storage: `ssh:${text(config.host).toLowerCase()}`, folder: accountFolder(config, config.pathPrefix) } : null),
    rsync: (config) => (text(config.host) ? { storage: `ssh:${text(config.host).toLowerCase()}`, folder: accountFolder(config, config.pathPrefix) } : null),
    // An FTP account usually starts in a root of its own.
    ftp: (config) => (text(config.host) ? { storage: `ftp:${text(config.host).toLowerCase()}:${text(config.username) || "anonymous"}`, folder: levelsOf(config.pathPrefix) } : null),
    smb: smbPlace,
    webdav: webdavPlace,
    "s3-aws": (config) => s3Place("amazonaws.com", config),
    "s3-generic": (config) => s3Place(urlHost(config.endpoint), config),
    "s3-r2": (config) => s3Place(`${text(config.accountId).toLowerCase()}.r2.cloudflarestorage.com`, config),
    "s3-hetzner": (config) => s3Place(`${text(config.region).toLowerCase()}.your-objectstorage.com`, config),
    "google-drive": (config) => drivePlace("google-drive", config, text(config.folderId) ? [text(config.folderId)] : []),
    dropbox: (config) => drivePlace("dropbox", config, levelsOf(config.folderPath)),
    onedrive: (config) => drivePlace("onedrive", config, levelsOf(config.folderPath)),
};

/** Where a storage connection keeps its files, null for an adapter that keeps none or a config that names no storage. */
export function storagePlaceOf(adapterId: string, config: Config): StoragePlace | null {
    const place = Object.hasOwn(PLACES, adapterId) ? PLACES[adapterId] : null;
    return place ? place(config ?? {}) : null;
}

/** Whether two places share files: the same storage, and one folder is the other or lies inside it. */
export function placesOverlap(a: StoragePlace, b: StoragePlace): boolean {
    if (a.storage !== b.storage) return false;
    const shorter = a.folder.length <= b.folder.length ? a.folder : b.folder;
    const longer = shorter === a.folder ? b.folder : a.folder;
    return shorter.every((level, index) => longer[index] === level);
}
