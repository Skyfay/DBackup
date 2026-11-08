/**
 * A connection that comes back from Recently deleted is stored like a save, so it meets the checks
 * of a save: its saved logins fit its type, a saved login of the destination of the configuration
 * backup signs in on it through a platform admin alone, and a storage connection keeps out of the
 * folder of a destination its tenant shares with customers. Before, a restore asked only whether
 * it reaches the server DBackup runs on.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";
import { CONFIG_BACKUP_LOGIN_APPLY_LOCKED } from "@/lib/core/config-backup-locks";

const mocks = vi.hoisted(() => ({ loginsOfConfigBackup: [] as string[] }));
vi.stubEnv("ENCRYPTION_KEY", "e".repeat(64));

vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));
vi.mock("@/services/config/config-backup-targets", () => ({
    getConfigBackupTargets: vi.fn(async () => ({ storageId: null, credentialIds: mocks.loginsOfConfigBackup, profileId: null })),
}));
vi.mock("@/lib/server/scheduler", () => ({ scheduler: { refresh: vi.fn(async () => undefined) } }));

const { restoreFromTrash } = await import("@/services/trash/trash-service");

const PLATFORM_ADMIN = { isPlatformAdmin: true, authMethod: "session" as const };
const MEMBER = { isPlatformAdmin: false, authMethod: "session" as const };

/** A deleted SFTP destination of the tenant, with the folder and the login given. */
function deletedSftp(pathPrefix: string, primaryCredentialId: string | null = null) {
    const record = {
        id: "conn-1",
        name: "NAS",
        type: "storage",
        storageRole: "DESTINATION",
        adapterId: "sftp",
        config: JSON.stringify({ host: "nas.internal", port: 22, username: "backup", pathPrefix }),
        primaryCredentialId,
        sshCredentialId: null,
    };
    return {
        id: "t-conn",
        kind: "connection",
        recordId: "conn-1",
        name: "NAS",
        detail: null,
        data: JSON.stringify({ record }),
        deletedAt: new Date(),
        permission: "destinations:write",
        superAdminOnly: false,
        tenantId: "default",
    };
}

/** The destination the tenant shares with its customers, whose backups lie under /shared. */
const SHARED = {
    config: { id: "dest-shared", name: "Customer backups", adapterId: "sftp", config: JSON.stringify({ host: "nas.internal", port: 22, username: "backup", pathPrefix: "/shared" }), primaryCredentialId: null, sshCredentialId: null },
};

describe("a storage connection that comes back from Recently deleted", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.loginsOfConfigBackup = [];
        prismaMock.$transaction.mockImplementation((async () => ({ name: "NAS", notes: [] })) as never);
        prismaMock.connectionShare.findMany.mockResolvedValue([SHARED] as never);
        prismaMock.credentialProfile.findUnique.mockResolvedValue(null);
    });

    it("stays out of the folder of a destination the tenant shares with customers", async () => {
        prismaMock.deletedRecord.findUnique.mockResolvedValue(deletedSftp("/shared/acme") as never);

        const result = await restoreFromTrash(["t-conn"], { caller: PLATFORM_ADMIN });

        expect(result.restored).toEqual([]);
        expect(result.failed).toEqual([{ id: "t-conn", name: "NAS", error: expect.stringContaining("Customer backups, a destination shared with customers") }]);
        expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it("comes back while its folder lies elsewhere", async () => {
        prismaMock.deletedRecord.findUnique.mockResolvedValue(deletedSftp("/own") as never);

        const result = await restoreFromTrash(["t-conn"], { caller: MEMBER });

        expect(result.restored).toHaveLength(1);
    });

    it("signs in with a saved login of the configuration backup through a platform admin alone", async () => {
        mocks.loginsOfConfigBackup = ["cred-cb"];
        prismaMock.deletedRecord.findUnique.mockResolvedValue(deletedSftp("/own", "cred-cb") as never);
        prismaMock.credentialProfile.findUnique.mockResolvedValue({ id: "cred-cb", type: "SSH_KEY" } as never);

        const refused = await restoreFromTrash(["t-conn"], { caller: MEMBER });
        expect(refused.failed).toEqual([{ id: "t-conn", name: "NAS", error: CONFIG_BACKUP_LOGIN_APPLY_LOCKED }]);
        // A restore that names nobody gets no right of a platform admin either.
        expect((await restoreFromTrash(["t-conn"])).failed).toEqual([{ id: "t-conn", name: "NAS", error: CONFIG_BACKUP_LOGIN_APPLY_LOCKED }]);
        expect(prismaMock.$transaction).not.toHaveBeenCalled();

        expect((await restoreFromTrash(["t-conn"], { caller: PLATFORM_ADMIN })).restored).toHaveLength(1);
    });

    it("does not come back with a saved login of a type it does not take", async () => {
        prismaMock.deletedRecord.findUnique.mockResolvedValue(deletedSftp("/own", "cred-pw") as never);
        prismaMock.credentialProfile.findUnique.mockResolvedValue({ id: "cred-pw", type: "USERNAME_PASSWORD" } as never);

        const result = await restoreFromTrash(["t-conn"], { caller: PLATFORM_ADMIN });

        expect(result.failed).toEqual([{ id: "t-conn", name: "NAS", error: "Credential profile type mismatch for primary slot: expected SSH_KEY, got USERNAME_PASSWORD." }]);
        expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it("comes back without a saved login deleted since, which the restore drops with a note", async () => {
        prismaMock.deletedRecord.findUnique.mockResolvedValue(deletedSftp("/own", "cred-gone") as never);

        const result = await restoreFromTrash(["t-conn"], { caller: MEMBER });

        expect(result.restored).toHaveLength(1);
    });
});
