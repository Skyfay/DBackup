import { beforeEach, describe, expect, it, vi } from "vitest";
import { PermissionError, ValidationError } from "@/lib/logging/errors";

/**
 * Where a restore of files may write. Docker Volumes without SSH reach the Docker of the server
 * DBackup runs on, and a restore empties each volume it writes into, so only a platform admin does
 * that. Over SSH the volume the backup read goes back for anyone who may restore, another one only
 * for someone who may change the connection. No folder of a request leaves its connection, and the
 * files that decide how DBackup reads backups or its configuration backup are written only by a
 * platform admin with a session.
 */

const db = vi.hoisted(() => ({
    rows: new Map<string, { id: string; adapterId: string; tenantId: string; config: string }>(),
    sources: new Map<string, { configId: string; path: string }>(),
    provided: new Set<string>(),
}));

vi.mock("@/lib/prisma", () => ({
    default: {
        adapterConfig: { findUnique: async ({ where }: { where: { id: string } }) => db.rows.get(where.id) ?? null },
        jobSource: { findUnique: async ({ where }: { where: { id: string } }) => db.sources.get(where.id) ?? null },
    },
}));
vi.mock("@/lib/crypto", () => ({ decryptConfig: (value: unknown) => value }));
// The volumes DBackup's own container keeps its data in, on the Docker of the server it runs on.
const own = vi.hoisted(() => ({ volumes: new Set<string>(), calls: [] as unknown[][] }));
const OWN_VOLUME = "DBackup's own container keeps its database in this volume.";
vi.mock("@/lib/adapters/own-data", () => ({
    ownVolumeRefusal: async (adapterId: string, config: Record<string, unknown>, volume: string) => {
        own.calls.push([adapterId, config, volume]);
        if (adapterId !== "docker-volume" || config.connectionMode === "ssh") return null;
        return own.volumes.has(volume.split("/")[0]) ? OWN_VOLUME : null;
    },
}));
const guard = vi.hoisted(() => ({ calls: 0 }));
vi.mock("@/lib/server/config-backup-target-guard", () => ({ configBackupTargetRefusal: async () => { guard.calls++; return null; } }));
// The connections another tenant shares with the caller.
vi.mock("@/services/sharing/provided", () => ({ providedIds: async (_tenantId: string, ids: string[]) => new Set(ids.filter((id) => db.provided.has(id))) }));

const {
    assertRestoreTargetsAllowed, assertWriteTargets, restoredFileRefusal, writeTargetRefusal,
    HOST_DOCKER_RESTORE_REFUSED, OTHER_VOLUME_REFUSED, OTHER_TARGET_REFUSED, CONFIG_BACKUP_PATH_REFUSED, SIDECAR_REFUSED, BACKUP_FILE_REFUSED, SMB_STREAM_REFUSED, SMB_SHORT_NAME_REFUSED,
    isOrigin, mappingFolder,
} = await import("@/services/restore/restore-targets");

const ADMIN = { isPlatformAdmin: true, authMethod: "session", tenantId: "default", permissions: [] } as const;
const ADMIN_KEY = { isPlatformAdmin: true, authMethod: "apikey", tenantId: "default", permissions: [] } as const;
const ADMIN_AT_CUSTOMER = { isPlatformAdmin: true, authMethod: "session", tenantId: "acme", permissions: [] } as const;
const MEMBER = { isPlatformAdmin: false, authMethod: "session", tenantId: "default", permissions: ["storage:restore"] } as const;
const MANAGER = { isPlatformAdmin: false, authMethod: "session", tenantId: "default", permissions: ["storage:restore", "destinations:write"] } as const;

const docker = (connectionMode: "direct" | "ssh", over: Partial<{ basePath: string; origin: boolean; tenantId: string }> = {}) => ({
    connectionId: "docker-1",
    adapterId: "docker-volume",
    tenantId: over.tenantId ?? "default",
    config: connectionMode === "ssh" ? { connectionMode, sshHost: "docker.lan", sshUsername: "ops", sshAuthType: "password" } : {},
    basePath: over.basePath ?? "nextcloud_data",
    origin: over.origin ?? false,
});

describe("a restore into Docker Volumes", () => {
    it("empties volumes of the Docker of the server only for a platform admin with a session in the home tenant", () => {
        for (const caller of [MEMBER, MANAGER, ADMIN_KEY, ADMIN_AT_CUSTOMER]) {
            expect(writeTargetRefusal(docker("direct", { origin: true }), caller)).toBe(HOST_DOCKER_RESTORE_REFUSED);
        }
        expect(writeTargetRefusal(docker("direct"), ADMIN)).toBeNull();
    });

    it("takes back the volume the backup read over SSH for anyone who may restore", () => {
        expect(writeTargetRefusal(docker("ssh", { origin: true }), MEMBER)).toBeNull();
    });

    it("writes another volume over SSH only for someone who may change the connection in its tenant", () => {
        expect(writeTargetRefusal(docker("ssh"), MEMBER)).toBe(OTHER_VOLUME_REFUSED);
        expect(writeTargetRefusal(docker("ssh"), MANAGER)).toBeNull();
        expect(writeTargetRefusal(docker("ssh", { tenantId: "acme" }), MANAGER)).toBe(OTHER_VOLUME_REFUSED);
        expect(writeTargetRefusal(docker("ssh"), ADMIN_KEY)).toBeNull();
    });
});

describe("the folder a restore writes into", () => {
    it("never leaves its connection, by .. or a part a storage reads as one", () => {
        const sftp = { connectionId: "sftp-1", adapterId: "sftp", tenantId: "default", config: {}, origin: false };
        for (const basePath of ["../home/ops/.ssh", "restores/../../etc", "%2e%2e/x", "restores/.. /x", "..."]) {
            expect(writeTargetRefusal({ ...sftp, basePath }, ADMIN), basePath).toMatch(/leaves its folder/);
        }
        expect(writeTargetRefusal({ ...sftp, basePath: "/restores/run-1/" }, MANAGER)).toBeNull();
    });

    it("is no config-backups folder for anyone but a platform admin with a session", () => {
        const sftp = { connectionId: "sftp-1", adapterId: "sftp", tenantId: "default", config: {}, origin: false };
        expect(writeTargetRefusal({ ...sftp, basePath: "shop/Config-Backups." }, MEMBER)).toBe(CONFIG_BACKUP_PATH_REFUSED);
        expect(writeTargetRefusal({ ...sftp, basePath: "config-backups" }, ADMIN_KEY)).toBe(CONFIG_BACKUP_PATH_REFUSED);
        expect(writeTargetRefusal({ ...sftp, basePath: "config-backups" }, ADMIN)).toBeNull();
    });
});

describe("a restore into another place than the folder the backup read", () => {
    const sftp = { connectionId: "sftp-1", adapterId: "sftp", tenantId: "default", config: {}, basePath: "Shop", origin: false };

    it("needs the right to change the connection it writes into, in the tenant of that connection", () => {
        // Over the backups of other jobs, whose .tar and .index it would replace without the right to delete them.
        expect(writeTargetRefusal(sftp, MEMBER)).toBe(OTHER_TARGET_REFUSED);
        expect(writeTargetRefusal(sftp, MANAGER)).toBeNull();
        expect(writeTargetRefusal({ ...sftp, tenantId: "acme" }, MANAGER)).toBe(OTHER_TARGET_REFUSED);
        expect(writeTargetRefusal(sftp, ADMIN_KEY)).toBeNull();
    });

    it("takes back the folder the backup read for anyone who may restore", () => {
        expect(writeTargetRefusal({ ...sftp, origin: true }, MEMBER)).toBeNull();
    });

    it("writes into a connection to the server DBackup runs on only for a platform admin with a session in the home tenant", () => {
        const local = { ...sftp, adapterId: "local-filesystem" };
        expect(writeTargetRefusal(local, MANAGER)).toBe(OTHER_TARGET_REFUSED);
        expect(writeTargetRefusal(local, ADMIN_KEY)).toBe(OTHER_TARGET_REFUSED);
        expect(writeTargetRefusal(local, ADMIN)).toBeNull();
        expect(writeTargetRefusal({ ...local, origin: true }, MEMBER)).toBeNull();
    });

    it("counts the folder of the source and the folders inside it as the place it read", () => {
        const source = { configId: "nas", path: "/var/www" };
        expect(isOrigin(source, "nas", "/var/www", "sftp")).toBe(true);
        expect(isOrigin(source, "nas", "var/www/uploads/", "sftp")).toBe(true);
        expect(isOrigin(source, "nas", "/var/www2", "sftp")).toBe(false);
        expect(isOrigin(source, "nas", "/var", "sftp")).toBe(false);
        expect(isOrigin(source, "other", "/var/www", "sftp")).toBe(false);
        expect(isOrigin(null, "nas", "/var/www", "sftp")).toBe(false);
    });
});

describe("the files a restore writes", () => {
    it("leaves the folder and the names of the configuration backup to a platform admin with a session", () => {
        for (const file of ["config-backups/config_backup_2026.db.gz.enc", "a/b/config-backups/x.txt", "CONFIG-BACKUPS/x", "www/config_backup_2026-10-01.db.gz.enc"]) {
            expect(restoredFileRefusal(file, MEMBER), file).toBe(CONFIG_BACKUP_PATH_REFUSED);
            expect(restoredFileRefusal(file, ADMIN_KEY), file).toBe(CONFIG_BACKUP_PATH_REFUSED);
            expect(restoredFileRefusal(file, ADMIN), file).toBeNull();
        }
    });

    it("writes no .meta.json beside a backup, which decides its retention, its lock and how it is read", () => {
        for (const file of ["Shop/Shop_2026-10-01.tar.meta.json", "Shop/x.META.JSON", "Shop/x.meta.json."]) {
            expect(restoredFileRefusal(file, MEMBER), file).toBe(SIDECAR_REFUSED);
        }
        expect(restoredFileRefusal("Shop/x.meta.json", ADMIN)).toBeNull();
        expect(restoredFileRefusal("www/package.json", MEMBER)).toBeNull();
        // A restore that names no caller writes as nobody with rights beyond it.
        expect(restoredFileRefusal("Shop/x.meta.json", undefined)).toBe(SIDECAR_REFUSED);
    });

    it("writes no file named like a backup or its index, which would replace a backup of another job", () => {
        for (const file of ["Shop/Shop_2026-10-01.tar", "Shop/Shop_2026-10-01.TAR.", "Shop/chain-1/inc-001.tar.index", "Old/shop.sql.gz.enc"]) {
            expect(restoredFileRefusal(file, MEMBER), file).toBe(BACKUP_FILE_REFUSED);
            expect(restoredFileRefusal(file, ADMIN_KEY), file).toBe(BACKUP_FILE_REFUSED);
            expect(restoredFileRefusal(file, ADMIN), file).toBeNull();
        }
        for (const file of ["www/site.tar.gz", "www/index.html", "www/notes.txt"]) {
            expect(restoredFileRefusal(file, MEMBER), file).toBeNull();
        }
    });

    it("restores a file named like a backup into a folder a job backs up, where it replaces no backup", () => {
        for (const file of ["www/archive.tar", "www/old/export.enc", "docs/search.index"]) {
            expect(restoredFileRefusal(file, MEMBER, false), file).toBeNull();
        }
        // The configuration backup and a sidecar stay refused there too.
        expect(restoredFileRefusal("www/x.meta.json", MEMBER, false)).toBe(SIDECAR_REFUSED);
        expect(restoredFileRefusal("www/config-backups/a", MEMBER, false)).toBe(CONFIG_BACKUP_PATH_REFUSED);
    });

    it("reads each name up to its first colon, where Windows starts an alternate data stream of the same file", () => {
        // `::$DATA` is the content of the file itself, `:$I30:$INDEX_ALLOCATION` the folder itself.
        expect(restoredFileRefusal("Shop/x.meta.json::$DATA", MEMBER)).toBe(SIDECAR_REFUSED);
        expect(restoredFileRefusal("Shop/x.meta.json:hidden", MEMBER)).toBe(SIDECAR_REFUSED);
        expect(restoredFileRefusal("Shop/Shop_2026-10-01.tar::$DATA", MEMBER)).toBe(BACKUP_FILE_REFUSED);
        expect(restoredFileRefusal("config-backups:$I30:$INDEX_ALLOCATION/x.txt", MEMBER)).toBe(CONFIG_BACKUP_PATH_REFUSED);
        expect(restoredFileRefusal("www/config_backup_1.db.gz.enc:x", MEMBER)).toBe(CONFIG_BACKUP_PATH_REFUSED);
        expect(restoredFileRefusal("www/notes.txt:x", MEMBER)).toBeNull();
    });

    it("writes no name with a colon into an SMB share, where it lands in a stream of another file, for anyone", () => {
        for (const caller of [MEMBER, ADMIN]) {
            expect(restoredFileRefusal("www/notes.txt:x", caller, false, "smb")).toBe(SMB_STREAM_REFUSED);
            expect(restoredFileRefusal("Shop/x.meta.json::$DATA", caller, true, "smb")).toBe(SMB_STREAM_REFUSED);
        }
        expect(restoredFileRefusal("www/notes.txt", MEMBER, false, "smb")).toBeNull();
        expect(restoredFileRefusal("www/12:00.txt", MEMBER, false, "sftp")).toBeNull();
    });

    it("compares every name without case, as a storage on Windows, macOS or SMB reads it", () => {
        const refused: [string, string][] = [
            ["Config-Backups/x.txt", CONFIG_BACKUP_PATH_REFUSED],
            ["www/CONFIG_BACKUP_2026.db.gz.enc", CONFIG_BACKUP_PATH_REFUSED],
            ["www/Config_Backup_2026.db.gz.enc", CONFIG_BACKUP_PATH_REFUSED],
            // A dotless i and a long s turn into I and S only in upper case, which such a storage compares.
            ["www/confıg_backup_2026.db.gz.enc", CONFIG_BACKUP_PATH_REFUSED],
            ["Shop/x.Meta.Json", SIDECAR_REFUSED],
            ["Shop/x.meta.jſon", SIDECAR_REFUSED],
            ["Shop/Shop_2026-10-01.Tar", BACKUP_FILE_REFUSED],
            ["Shop/chain-1/inc-001.tar.ındex", BACKUP_FILE_REFUSED],
        ];
        for (const [file, refusal] of refused) {
            expect(restoredFileRefusal(file, MEMBER), file).toBe(refusal);
            expect(restoredFileRefusal(file, MEMBER, true, "smb"), file).toBe(refusal);
            expect(restoredFileRefusal(file, ADMIN), file).toBeNull();
        }
    });

    it("writes no name part like CONFIG~1 into an SMB share, which may be the short name of the configuration backup folder", () => {
        for (const file of ["CONFIG~1/config_backup_1.db.gz.enc", "www/CONFIG~12/x.txt", "Shop/XMETA~1.JSO", "www/report~3.txt"]) {
            expect(restoredFileRefusal(file, MEMBER, false, "smb"), file).toBe(SMB_SHORT_NAME_REFUSED);
            expect(restoredFileRefusal(file, ADMIN_KEY, false, "smb"), file).toBe(SMB_SHORT_NAME_REFUSED);
            expect(restoredFileRefusal(file, ADMIN, false, "smb"), file).toBeNull();
        }
        // Elsewhere such a name is a name like any other, and a tilde without a digit is no short name.
        expect(restoredFileRefusal("www/report~3.txt", MEMBER, false, "sftp")).toBeNull();
        expect(restoredFileRefusal("www/~draft.txt", MEMBER, false, "smb")).toBeNull();
        expect(restoredFileRefusal("www/backup~old/x.txt", MEMBER, false, "smb")).toBeNull();
    });
});

describe("a restore into a Docker volume of DBackup itself", () => {
    beforeEach(() => {
        own.volumes.clear();
        own.calls.length = 0;
    });

    it("is refused to everyone, a platform admin too, like a run refuses to read it", async () => {
        own.volumes.add("dbackup_data");
        const target = { ...docker("direct", { basePath: "dbackup_data/db", origin: true }) };

        await expect(assertWriteTargets([target], ADMIN)).rejects.toThrow(OWN_VOLUME);
        await expect(assertWriteTargets([target], ADMIN)).rejects.toBeInstanceOf(ValidationError);
        expect(own.calls[0]).toEqual(["docker-volume", target.config, "dbackup_data/db"]);
        // Any other volume of the same Docker stays the platform admin's to restore into.
        await expect(assertWriteTargets([docker("direct", { basePath: "nextcloud_data" })], ADMIN)).resolves.toBeUndefined();
    });

    it("is refused in the directory mappings of a full restore too", async () => {
        own.volumes.add("dbackup_data");
        db.rows.set("docker-local", { id: "docker-local", adapterId: "docker-volume", tenantId: "default", config: JSON.stringify({}) });

        await expect(assertRestoreTargetsAllowed({ directoryMapping: [{ entryId: "src-x", targetConfigId: "docker-local", targetPath: "dbackup_data", selected: true }] }, ADMIN)).rejects.toThrow(OWN_VOLUME);
    });
});

describe("the directory mappings of a full restore", () => {
    beforeEach(() => {
        db.rows.clear();
        db.sources.clear();
        db.rows.set("docker-local", { id: "docker-local", adapterId: "docker-volume", tenantId: "default", config: JSON.stringify({}) });
        db.rows.set("docker-ssh", { id: "docker-ssh", adapterId: "docker-volume", tenantId: "default", config: JSON.stringify({ connectionMode: "ssh", sshHost: "docker.lan", sshUsername: "ops" }) });
        db.rows.set("nas", { id: "nas", adapterId: "sftp", tenantId: "default", config: "{}" });
        db.sources.set("src-1", { configId: "docker-ssh", path: "nextcloud_data" });
        db.sources.set("src-www", { configId: "nas", path: "/var/www" });
    });

    const mapping = (targetConfigId: string, targetPath: string) => ({ directoryMapping: [{ entryId: "src-1", targetConfigId, targetPath, selected: true }] });

    it("refuses the Docker of the server before anything runs, unless a platform admin restores", async () => {
        await expect(assertRestoreTargetsAllowed(mapping("docker-local", "nextcloud_data"), MEMBER)).rejects.toBeInstanceOf(PermissionError);
        await expect(assertRestoreTargetsAllowed(mapping("docker-local", "nextcloud_data"), ADMIN)).resolves.toBeUndefined();
    });

    it("takes back the volume the source read over SSH, and refuses another one to a member", async () => {
        await expect(assertRestoreTargetsAllowed(mapping("docker-ssh", "nextcloud_data"), MEMBER)).resolves.toBeUndefined();
        await expect(assertRestoreTargetsAllowed(mapping("docker-ssh", "postgres_data"), MEMBER)).rejects.toThrow(OTHER_VOLUME_REFUSED);
        await expect(assertRestoreTargetsAllowed(mapping("docker-ssh", "postgres_data"), MANAGER)).resolves.toBeUndefined();
    });

    it("takes back the folder a source read, and refuses another place to a member", async () => {
        const www = (targetConfigId: string, targetPath: string) => ({ directoryMapping: [{ entryId: "src-www", targetConfigId, targetPath, selected: true }] });
        await expect(assertRestoreTargetsAllowed(www("nas", "/var/www"), MEMBER)).resolves.toBeUndefined();
        await expect(assertRestoreTargetsAllowed(www("nas", "/backups/Shop"), MEMBER)).rejects.toThrow(OTHER_TARGET_REFUSED);
        await expect(assertRestoreTargetsAllowed(www("nas", "/backups/Shop"), MANAGER)).resolves.toBeUndefined();
    });

    it("refuses a folder that leaves its connection", async () => {
        await expect(assertRestoreTargetsAllowed(mapping("nas", "../../root"), ADMIN)).rejects.toBeInstanceOf(ValidationError);
    });

    it("refuses a picked source without a folder, which the restore would otherwise fill with a name from the archive", async () => {
        await expect(assertRestoreTargetsAllowed(mapping("nas", ""), ADMIN)).rejects.toThrow("Pick the folder each restored directory source goes into.");
        await expect(assertRestoreTargetsAllowed(mapping("nas", "   "), MANAGER)).rejects.toBeInstanceOf(ValidationError);
        // A source left out writes nothing, so it needs no folder.
        await expect(assertRestoreTargetsAllowed({ directoryMapping: [{ entryId: "src-1", targetConfigId: "nas", targetPath: "", selected: false }] }, MEMBER)).resolves.toBeUndefined();
    });

    it("refuses a connection of another tenant before any other check, in the words of one that does not exist", async () => {
        db.rows.set("acme-nas", { id: "acme-nas", adapterId: "sftp", tenantId: "acme", config: "{}" });
        db.sources.set("src-acme", { configId: "acme-nas", path: "/var/www" });
        guard.calls = 0;
        own.calls.length = 0;
        const acme = { directoryMapping: [{ entryId: "src-acme", targetConfigId: "acme-nas", targetPath: "/var/www", selected: true }] };
        const missing = "Invalid restore target for a directory entry: adapter 'acme-nas' not found";
        for (const caller of [MEMBER, MANAGER, ADMIN]) {
            await expect(assertRestoreTargetsAllowed(acme, caller)).rejects.toThrow(missing);
        }
        // Left out of the pick, the restore still opens it for the source, so it counts too.
        await expect(assertRestoreTargetsAllowed({ directoryMapping: [{ ...acme.directoryMapping[0], selected: false }] }, ADMIN)).rejects.toThrow(missing);
        await expect(assertRestoreTargetsAllowed({ targetSourceId: "acme-nas" }, ADMIN)).rejects.toThrow("Target source not found");
        await expect(assertRestoreTargetsAllowed(acme, { isPlatformAdmin: true, authMethod: "session" })).rejects.toThrow(missing);
        expect(guard.calls).toBe(0);
        expect(own.calls).toEqual([]);
        // Acme sees its own connection.
        await expect(assertRestoreTargetsAllowed(acme, { ...MEMBER, tenantId: "acme" })).resolves.toBeUndefined();
    });

    it("lets through a connection another tenant provides to the caller", async () => {
        db.rows.set("msp-nas", { id: "msp-nas", adapterId: "sftp", tenantId: "msp", config: "{}" });
        db.provided.add("msp-nas");
        try {
            await expect(assertRestoreTargetsAllowed({ directoryMapping: [{ entryId: "src-www", targetConfigId: "msp-nas", targetPath: "/restores", selected: true }] }, MANAGER)).rejects.toThrow(OTHER_TARGET_REFUSED);
        } finally {
            db.provided.clear();
        }
    });

    it("reads the folder the restore writes into the same way the restore does", () => {
        expect(mappingFolder({ targetPath: "/var/www" })).toBe("/var/www");
        expect(mappingFolder({ targetPath: "" })).toBeNull();
        expect(mappingFolder({ targetPath: " " })).toBeNull();
        expect(mappingFolder({})).toBeNull();
    });
});
