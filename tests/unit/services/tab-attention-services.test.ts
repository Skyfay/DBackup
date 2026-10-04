import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";

const mocks = vi.hoisted(() => ({ profiles: vi.fn(), keyAudit: vi.fn() }));

vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));
vi.mock("@/services/auth/credential-service", () => ({ listCredentialProfilesForVault: (...args: unknown[]) => mocks.profiles(...args) }));
vi.mock("@/services/vault/vault-audit", () => ({ keyAudit: (...args: unknown[]) => mocks.keyAudit(...args) }));

const { getUsersPageAttention } = await import("@/services/user/users-model");
const { getConnectionAttention } = await import("@/services/adapters/adapter-service");
const { getHistoryAttention } = await import("@/services/history/history-attention");
const { getVaultAttention } = await import("@/services/vault/vault-counts");

const NOW = Date.parse("2026-09-30T12:00:00.000Z");
// Prisma's groupBy overloads are too deep for the mock types.
const mocked = (fn: unknown) => fn as Mock;

describe("the dots of the page tabs worked out on the server", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("marks Users for someone without a group and API keys for a working key that runs out within two weeks", async () => {
        prismaMock.user.findMany.mockResolvedValue([{ name: "Sara Nguyen" }] as never);
        prismaMock.apiKey.findMany.mockResolvedValue([{ name: "CI deploy" }, { name: "Backup bot" }] as never);

        expect(await getUsersPageAttention(NOW)).toEqual({
            users: { tone: "warning", note: "Sara Nguyen has no group and sees nothing" },
            apikeys: { tone: "warning", note: "CI deploy and Backup bot run out within two weeks" },
        });
        expect(prismaMock.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { groupId: null } }));
        expect(prismaMock.apiKey.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { enabled: true, expiresAt: { gt: new Date(NOW), lte: new Date(NOW + 14 * 86_400_000) } },
        }));
    });

    it("marks each Connections tab by the health check of its connections", async () => {
        prismaMock.adapterConfig.findMany.mockResolvedValue([
            { name: "db-prod", type: "database", storageRole: null, lastStatus: "OFFLINE" },
            { name: "NAS", type: "storage", storageRole: "DESTINATION", lastStatus: "DEGRADED" },
            { name: "Photos", type: "storage", storageRole: "SOURCE", lastStatus: "OFFLINE" },
        ] as never);

        expect(await getConnectionAttention()).toEqual({
            databases: { tone: "destructive", note: "db-prod does not answer" },
            sources: { tone: "destructive", note: "Photos does not answer" },
            destinations: { tone: "warning", note: "NAS failed its last check" },
            notifications: undefined,
        });
        expect(prismaMock.adapterConfig.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { lastStatus: { in: ["OFFLINE", "DEGRADED"] } } }));
    });

    it("leaves an air-gapped destination that is not connected out of the Destinations tab", async () => {
        prismaMock.adapterConfig.findMany.mockResolvedValue([
            { name: "USB rotation", type: "storage", storageRole: "DESTINATION", lastStatus: "OFFLINE", metadata: JSON.stringify({ airGapped: true }) },
            { name: "NAS", type: "storage", storageRole: "DESTINATION", lastStatus: "OFFLINE", metadata: null },
        ] as never);

        expect((await getConnectionAttention()).destinations).toEqual({ tone: "destructive", note: "NAS does not answer" });
    });

    it("marks History by the newest run of each job and the newest message of each channel, not by older failures", async () => {
        const newest = new Date("2026-09-30T03:00:00.000Z");
        mocked(prismaMock.execution.groupBy).mockResolvedValue([{ jobId: "mysql", _max: { startedAt: newest } }, { jobId: "files", _max: { startedAt: newest } }] as never);
        mocked(prismaMock.notificationLog.groupBy).mockResolvedValue([{ channelId: "slack", _max: { sentAt: newest } }] as never);
        prismaMock.execution.findMany.mockResolvedValue([{ status: "Failed", job: { name: "Nightly MySQL" } }, { status: "Partial", job: { name: "Files to NAS" } }] as never);
        prismaMock.notificationLog.findMany.mockResolvedValue([{ channelId: "slack" }] as never);
        prismaMock.adapterConfig.findMany.mockResolvedValue([{ name: "Slack ops" }] as never);

        expect(await getHistoryAttention()).toEqual({
            runs: { tone: "destructive", note: "Nightly MySQL failed on its last run. Files to NAS missed a copy on its last run" },
            notifications: { tone: "destructive", note: "Slack ops failed to send its last message" },
        });
        expect(prismaMock.execution.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ status: { in: ["Failed", "Partial"] }, OR: [{ jobId: "mysql", startedAt: newest }, { jobId: "files", startedAt: newest }] }),
        }));
    });

    it("has nothing to say for History without runs or messages", async () => {
        mocked(prismaMock.execution.groupBy).mockResolvedValue([] as never);
        mocked(prismaMock.notificationLog.groupBy).mockResolvedValue([] as never);

        expect(await getHistoryAttention()).toEqual({ runs: undefined, notifications: undefined });
        expect(prismaMock.execution.findMany).not.toHaveBeenCalled();
    });

    it("marks the Vault for a profile that cannot log in and a key in no recovery kit, older kits from the audit log", async () => {
        mocks.profiles.mockResolvedValue([{ name: "Offsite S3", attention: "Its secret does not open" }, { name: "Local", attention: null }]);
        prismaMock.encryptionProfile.findMany.mockResolvedValue([
            { id: "k1", name: "Main", kitDownloadedAt: new Date(NOW) },
            { id: "k2", name: "Old", kitDownloadedAt: null },
            { id: "k3", name: "Offsite", kitDownloadedAt: null },
        ] as never);
        mocks.keyAudit.mockResolvedValue({ kits: [{ profileIds: ["k2"] }], reveals: new Map(), created: new Map() });

        expect(await getVaultAttention(true)).toEqual({
            credentials: { tone: "warning", note: "Offsite S3 cannot log in" },
            encryption: { tone: "warning", note: "Offsite is in no recovery kit" },
        });
    });

    it("leaves the credentials out for someone who cannot read them", async () => {
        prismaMock.encryptionProfile.findMany.mockResolvedValue([{ id: "k1", name: "Main", kitDownloadedAt: new Date(NOW) }] as never);

        expect(await getVaultAttention(false)).toEqual({ credentials: undefined, encryption: undefined });
        expect(mocks.profiles).not.toHaveBeenCalled();
        expect(mocks.keyAudit).not.toHaveBeenCalled();
    });
});
