/**
 * Editing a connection where it touches other tenants: a destination shared with them keeps its
 * place and its role, a new role passes the limits of the tenant, the jobs in the way of a role
 * change are looked up in every tenant, and nothing outside the platform turns into a connection
 * that reaches the server DBackup runs on.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.stubEnv("ENCRYPTION_KEY", "b".repeat(64));

const mocks = vi.hoisted(() => ({
    isShared: vi.fn(),
    profiles: {} as Record<string, Record<string, unknown>>,
}));

vi.mock("@/lib/adapters", () => ({ registerAdapters: vi.fn() }));
vi.mock("@/lib/adapters/credential-validation", () => ({ validateCredentialAssignments: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/adapters/snapshot-validation", () => ({ validateSnapshotConfig: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/services/sharing/destination-access", () => ({ isShared: (...args: unknown[]) => mocks.isShared(...args) }));
// A profile is laid over the config the way the resolver does it, by its id.
vi.mock("@/lib/adapters/config-resolver", () => {
    const overlay = async (_adapterId: string, config: Record<string, unknown>, primary: string | null, ssh: string | null) => ({
        ...config,
        ...(primary ? mocks.profiles[primary] : {}),
        ...(ssh ? mocks.profiles[ssh] : {}),
    });
    return { overlayCredentialsOnConfig: overlay, layLoginsOver: overlay };
});

import { prismaMock } from "@/lib/testing/prisma-mock";
import { encryptConfig } from "@/lib/crypto";
import { runAsTenant } from "@/lib/tenant/context";
import { HOME_TENANT_ID } from "@/lib/tenant/home";
import { movedLocationKeys, updateAdapter } from "@/services/adapters/adapter-update";

const S3 = { region: "eu-central-1", bucket: "msp-backups", pathPrefix: "backups", accessKeyId: "AKIA", secretAccessKey: "secret" };

function stored(overrides: Record<string, unknown> = {}, config: Record<string, unknown> = S3) {
    return {
        id: "dest-1",
        name: "Shared S3",
        type: "storage",
        adapterId: "s3-aws",
        config: JSON.stringify(encryptConfig(config)),
        metadata: null,
        primaryCredentialId: null,
        sshCredentialId: null,
        storageRole: "DESTINATION",
        lastError: null,
        ...overrides,
    };
}

describe("editing a destination shared with other tenants", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.profiles = {};
        mocks.isShared.mockResolvedValue(true);
        prismaMock.adapterConfig.findUnique.mockResolvedValue(stored() as never);
        prismaMock.adapterConfig.findFirst.mockResolvedValue(null);
        // The tenant shares no destination with customers.
        prismaMock.connectionShare.findMany.mockResolvedValue([]);
        prismaMock.adapterConfig.update.mockImplementation((async ({ data }: { data: Record<string, unknown> }) => ({ ...stored(), ...data })) as never);
        prismaMock.credentialProfile.findMany.mockResolvedValue([]);
        prismaMock.jobDestination.findMany.mockResolvedValue([]);
        prismaMock.jobSource.findMany.mockResolvedValue([]);
    });

    it("refuses a folder that would reach into the backups of its customers", async () => {
        await expect(updateAdapter("dest-1", { config: { ...S3, pathPrefix: "backups/tenants/acme" } }))
            .rejects.toThrow("It is shared with other tenants, so where it keeps the files stays as it is. Stop sharing it first.");
        expect(prismaMock.adapterConfig.update).not.toHaveBeenCalled();
    });

    it("refuses another bucket and a config that leaves the folder out", async () => {
        await expect(updateAdapter("dest-1", { config: { ...S3, bucket: "elsewhere" } })).rejects.toThrow("stays as it is");
        const { pathPrefix: _dropped, ...withoutFolder } = S3;
        await expect(updateAdapter("dest-1", { config: withoutFolder })).rejects.toThrow("stays as it is");
        expect(prismaMock.adapterConfig.update).not.toHaveBeenCalled();
    });

    it("takes a new secret, a new name and a setting that does not move the files", async () => {
        const result = await updateAdapter("dest-1", { name: "Shared S3 (EU)", config: { ...S3, secretAccessKey: "rotated", maxConcurrentFiles: 4 } });

        expect(result?.adapter.name).toBe("Shared S3 (EU)");
        expect(prismaMock.adapterConfig.update).toHaveBeenCalledTimes(1);
    });

    it("counts a port written as text and as a number as the same place", async () => {
        prismaMock.adapterConfig.findUnique.mockResolvedValue(stored({ adapterId: "sftp" }, { host: "nas", port: 22, username: "backup", pathPrefix: "/srv" }) as never);

        await expect(updateAdapter("dest-1", { config: { host: "nas", port: "22", username: "backup", pathPrefix: "/srv", password: "new" } })).resolves.not.toBeNull();
    });

    it("refuses a login that logs in as another account, whose folders are others", async () => {
        const sftp = { host: "nas", port: 22, pathPrefix: "/srv" };
        mocks.profiles = { old: { username: "backup" }, other: { username: "root" }, same: { username: "backup" } };
        prismaMock.adapterConfig.findUnique.mockResolvedValue(stored({ adapterId: "sftp", primaryCredentialId: "old" }, sftp) as never);

        await expect(updateAdapter("dest-1", { primaryCredentialId: "other" })).rejects.toThrow("stays as it is");
        await expect(updateAdapter("dest-1", { primaryCredentialId: "same" })).resolves.not.toBeNull();
    });

    it("keeps it a destination, a directory source would hand the backups of its customers to its tenant", async () => {
        await expect(updateAdapter("dest-1", { storageRole: "SOURCE" }))
            .rejects.toThrow("It is shared with other tenants, so it stays a destination. Stop sharing it first.");
        expect(prismaMock.jobDestination.findMany).not.toHaveBeenCalled();
        expect(prismaMock.adapterConfig.update).not.toHaveBeenCalled();
    });

    it("does not ask whether a notification channel is shared, its place is not a folder of backups", async () => {
        prismaMock.adapterConfig.findUnique.mockResolvedValue(stored({ type: "notification", adapterId: "discord" }, { webhookUrl: "https://a.example" }) as never);

        await expect(updateAdapter("dest-1", { config: { webhookUrl: "https://b.example" } })).resolves.not.toBeNull();
        expect(mocks.isShared).not.toHaveBeenCalled();
    });

    it("compares only the keys that say where the files are", () => {
        expect(movedLocationKeys({ host: "a", port: 22, password: "x" }, { host: "a", port: "22", password: "y" })).toEqual([]);
        expect(movedLocationKeys({ pathPrefix: "" }, {})).toEqual([]);
        expect(movedLocationKeys({ basePath: "/backups" }, { basePath: "/" })).toEqual(["basePath"]);
    });
});

describe("changing the role of a storage connection", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.isShared.mockResolvedValue(false);
        prismaMock.adapterConfig.findUnique.mockResolvedValue(stored() as never);
        prismaMock.adapterConfig.update.mockImplementation((async ({ data }: { data: Record<string, unknown> }) => ({ ...stored(), ...data })) as never);
        prismaMock.credentialProfile.findMany.mockResolvedValue([]);
        prismaMock.connectionShare.findMany.mockResolvedValue([]);
        prismaMock.jobDestination.findMany.mockResolvedValue([]);
        prismaMock.jobSource.findMany.mockResolvedValue([]);
        prismaMock.tenant.findUnique.mockImplementation((async ({ where }: { where: { id: string } }) => (where.id === HOME_TENANT_ID
            ? { name: "MSP" }
            : { name: "Acme", addsDatabases: true, addsDirectorySources: false, addsDestinations: true, addsChannels: true })) as never);
    });

    it("refuses a role whose connections the platform does not let the tenant add", async () => {
        await expect(runAsTenant("acme", () => updateAdapter("dest-1", { storageRole: "SOURCE" })))
            .rejects.toThrow("Acme adds no directory sources of its own");
        expect(prismaMock.adapterConfig.update).not.toHaveBeenCalled();
    });

    it("looks for the jobs in the way in every tenant and names only those of its own", async () => {
        prismaMock.tenant.findUnique.mockResolvedValue({ name: "Acme", addsDatabases: true, addsDirectorySources: true, addsDestinations: true, addsChannels: true } as never);
        prismaMock.jobDestination.findMany.mockResolvedValue([
            { job: { name: "Nightly", tenantId: "acme" } },
            { job: { name: "Secret job of another tenant", tenantId: "globex" } },
            { job: { name: "Another one", tenantId: "initech" } },
        ] as never);

        const refused = runAsTenant("acme", () => updateAdapter("dest-1", { storageRole: "SOURCE" }));
        await expect(refused).rejects.toThrow("it is used as a destination in Nightly, 2 jobs of other tenants.");
        await expect(refused).rejects.not.toThrow("Secret job");
    });
});

describe("an edit that would reach the server DBackup runs on", () => {
    const docker = { connectionMode: "ssh", sshHost: "docker.acme", sshUsername: "backup", sshAuthType: "password", sshPassword: "pw" };

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.isShared.mockResolvedValue(false);
        prismaMock.adapterConfig.findUnique.mockResolvedValue(stored({ adapterId: "docker-volume", storageRole: "SOURCE" }, docker) as never);
        prismaMock.adapterConfig.update.mockImplementation((async ({ data }: { data: Record<string, unknown> }) => ({ ...stored(), ...data })) as never);
        prismaMock.credentialProfile.findMany.mockResolvedValue([]);
        prismaMock.connectionShare.findMany.mockResolvedValue([]);
    });

    it("refuses Docker Volumes switched from SSH to the socket of the server in a customer's tenant", async () => {
        await expect(runAsTenant("acme", () => updateAdapter("dest-1", { config: { ...docker, connectionMode: "direct" } })))
            .rejects.toThrow("Docker Volumes without SSH reach the Docker of the server DBackup runs on");
        expect(prismaMock.adapterConfig.update).not.toHaveBeenCalled();
    });

    it("refuses an SSH key profile that logs in through the agent of the server", async () => {
        mocks.profiles = { agent: { sshAuthType: "agent" } };

        await expect(runAsTenant("acme", () => updateAdapter("dest-1", { sshCredentialId: "agent" }))).rejects.toThrow("An SSH agent login");
    });

    it("lets the platform switch it, and leaves a rename alone", async () => {
        await expect(runAsTenant(HOME_TENANT_ID, () => updateAdapter("dest-1", { config: { ...docker, connectionMode: "direct" } }))).resolves.not.toBeNull();
        await expect(runAsTenant("acme", () => updateAdapter("dest-1", { name: "Volumes" }))).resolves.not.toBeNull();
    });
});
