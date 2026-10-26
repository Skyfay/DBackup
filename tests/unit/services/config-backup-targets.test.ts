/**
 * What the configuration backup goes through, read from its settings: the destination, the saved
 * logins that destination signs in with and the key. The Connections page and the Vault mark them,
 * so a member who may not change them sees why their buttons stay shut.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";

vi.stubEnv("ENCRYPTION_KEY", "a".repeat(64));

const mocks = vi.hoisted(() => ({
    profiles: vi.fn(),
}));

vi.mock("@/lib/logging/logger", () => ({ logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) } }));
vi.mock("@/lib/adapters", () => ({ registerAdapters: vi.fn() }));
vi.mock("@/services/adapters/connection-overview", () => ({ getConnectionOverview: vi.fn() }));
vi.mock("@/services/sharing/connection-options", () => ({ providedItems: vi.fn().mockResolvedValue([]) }));
vi.mock("@/services/sharing/connection-shares", () => ({ connectionShareService: { summaries: vi.fn().mockResolvedValue(new Map()) } }));
vi.mock("@/services/auth/credential-service", () => ({ listCredentialProfilesForVault: mocks.profiles }));
vi.mock("@/services/system/data-retention-service", () => ({ getDataRetentionValues: async () => ({ auditLog: 90 }) }));
vi.mock("@/services/vault/vault-audit", () => ({
    credentialAudit: async () => ({ reveals: new Map(), created: new Map(), changed: new Map(), revealRows: [] }),
}));

const { getConfigBackupTargets } = await import("@/services/config/config-backup-targets");
const { listAdapters } = await import("@/services/adapters/adapter-list");
const { getVaultCredentials } = await import("@/services/vault/vault-credentials");

const settings = (storageId: string, profileId: string) => [
    { key: "config.backup.storageId", value: storageId },
    { key: "config.backup.profileId", value: profileId },
];

const destination = (id: string) => ({
    id, name: id, type: "storage", adapterId: "local", config: "{}", metadata: null,
    createdAt: new Date("2026-09-01"), updatedAt: new Date("2026-09-01"), primaryCredentialId: null, sshCredentialId: null,
    defaultRetentionPolicyId: null, lastHealthCheck: null, lastStatus: "ONLINE", lastError: null, consecutiveFailures: 0,
    storageRole: "DESTINATION", tenantId: "default",
});

const profile = (id: string) => ({
    id, name: id, type: "USERNAME_PASSWORD", description: null, createdAt: new Date("2026-09-01"), updatedAt: new Date("2026-09-01"),
    holds: "user backup", attention: null, uses: [],
});

beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.systemSetting.findMany.mockResolvedValue(settings("nas", "config-key") as never);
    prismaMock.adapterConfig.findUnique.mockResolvedValue({ primaryCredentialId: "nas-login", sshCredentialId: "nas-ssh" } as never);
});

describe("what the configuration backup goes through", () => {
    it("is its destination with both logins of it and its key", async () => {
        expect(await getConfigBackupTargets()).toEqual({ storageId: "nas", profileId: "config-key", credentialIds: ["nas-login", "nas-ssh"] });
        expect(prismaMock.adapterConfig.findUnique).toHaveBeenCalledWith({ where: { id: "nas" }, select: { primaryCredentialId: true, sshCredentialId: true } });
    });

    it("is nothing while no destination and no key are picked", async () => {
        prismaMock.systemSetting.findMany.mockResolvedValue(settings("", "") as never);

        expect(await getConfigBackupTargets()).toEqual({ storageId: null, profileId: null, credentialIds: [] });
        expect(prismaMock.adapterConfig.findUnique).not.toHaveBeenCalled();
    });
});

describe("the marks of the pages", () => {
    it("mark the destination of the configuration backup in the list of destinations", async () => {
        prismaMock.adapterConfig.findMany.mockResolvedValue([destination("nas"), destination("s3")] as never);

        const items = await listAdapters("storage");

        expect(items.find((item) => item.id === "nas")?.configBackup).toBe(true);
        expect(items.find((item) => item.id === "s3")?.configBackup).toBeUndefined();
    });

    it("mark the logins of that destination in the Vault", async () => {
        mocks.profiles.mockResolvedValue([profile("nas-login"), profile("db-login")]);

        const model = await getVaultCredentials();

        expect(model.profiles.find((row) => row.id === "nas-login")?.configBackup).toBe(true);
        expect(model.profiles.find((row) => row.id === "db-login")?.configBackup).toBeUndefined();
    });
});
