/**
 * A configuration restore onto another DBackup, like a new one after a lost server (issue 171).
 * A link to what the file does not hold is dropped instead of stopping the restore on a foreign
 * key, and the result says what that changed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockReset } from "vitest-mock-extended";
import { prismaMock } from "@/lib/testing/prisma-mock";
import { importConfiguration } from "@/services/config/import";

vi.mock("@/lib/crypto", () => ({
    encrypt: vi.fn((text: string) => `ENC_${text}`),
    encryptConfig: vi.fn((conf: unknown) => conf),
}));

vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

function backup(overrides: Record<string, unknown> = {}) {
    return {
        metadata: { version: "3.4.0", sourceType: "SYSTEM", exportedAt: "2026-09-29T03:00:00.000Z", includeSecrets: true },
        settings: [],
        credentialProfiles: [],
        adapters: [],
        jobs: [],
        jobDestinations: [],
        jobNotifications: {},
        apiKeys: [],
        users: [],
        groups: [],
        ssoProviders: [],
        encryptionProfiles: [],
        ...overrides,
    } as never;
}

const adapter = (id: string, name: string, type = "storage") => ({ id, name, type, adapterId: "local-filesystem", config: "{}" });
const job = (fields: Record<string, unknown> = {}) => ({
    id: "job-1",
    name: "Shop nightly",
    enabled: true,
    sourceId: "db-1",
    encryptionProfileId: null,
    namingTemplateId: null,
    schedulePresetId: null,
    ...fields,
});
const destination = (fields: Record<string, unknown> = {}) => ({ id: "dest-1", jobId: "job-1", configId: "nas", priority: 0, retention: "{}", retentionPolicyId: null, ...fields });

const firstCall = (fn: unknown) => (fn as { mock: { calls: [{ create: Record<string, unknown> }][] } }).mock.calls[0][0].create;

beforeEach(() => {
    mockReset(prismaMock);
    prismaMock.$transaction.mockImplementation((async (callback: (tx: unknown) => unknown) => callback(prismaMock)) as never);
});

describe("restoring a configuration onto a new DBackup", () => {
    it("keeps every backup at a destination whose retention policy the file does not hold, instead of stopping on a foreign key", async () => {
        const result = await importConfiguration(backup({
            adapters: [adapter("db-1", "Shop", "database"), adapter("nas", "NAS")],
            jobs: [job()],
            jobDestinations: [destination({ retentionPolicyId: "policy-gone" })],
        }), "OVERWRITE");

        expect(firstCall(prismaMock.jobDestination.upsert)).toMatchObject({ jobId: "job-1", configId: "nas", retentionPolicyId: null, retention: JSON.stringify({ mode: "NONE" }) });
        expect(result.notes).toEqual(["1 job destination keeps every backup until a retention policy is picked again, since the file holds no retention policies."]);
    });

    it("moves the destinations and channels of a job that merged into one of the same name onto that job", async () => {
        prismaMock.job.findFirst.mockResolvedValueOnce({ id: "job-here", name: "Shop nightly" } as never);
        prismaMock.jobDestination.findUnique.mockResolvedValueOnce({ id: "dest-here" } as never);

        await importConfiguration(backup({
            adapters: [adapter("db-1", "Shop", "database"), adapter("nas", "NAS"), adapter("mail", "Admins", "notification")],
            jobs: [job()],
            jobDestinations: [destination()],
            jobNotifications: { "job-1": ["mail"] },
        }), "OVERWRITE");

        expect(prismaMock.jobDestination.findUnique).toHaveBeenCalledWith({ where: { jobId_configId: { jobId: "job-here", configId: "nas" } } });
        expect(prismaMock.jobDestination.update).toHaveBeenCalledWith({ where: { id: "dest-here" }, data: expect.objectContaining({ jobId: "job-here", configId: "nas" }) });
        expect(prismaMock.jobDestination.upsert).not.toHaveBeenCalled();
        expect(prismaMock.job.update).toHaveBeenCalledWith({ where: { id: "job-here" }, data: { notifications: { set: [{ id: "mail" }] } } });
    });

    it("leaves out a destination whose connection is neither in the file nor here", async () => {
        const result = await importConfiguration(backup({
            adapters: [adapter("db-1", "Shop", "database")],
            jobs: [job()],
            jobDestinations: [destination({ configId: "nas-gone" })],
        }), "OVERWRITE");

        expect(prismaMock.jobDestination.upsert).not.toHaveBeenCalled();
        expect(result.notes).toEqual(["1 destination of a job was left out, since the job or the connection is not here."]);
    });

    it("pauses a job whose encryption key is not here, so it does not back up unencrypted", async () => {
        const result = await importConfiguration(backup({
            adapters: [adapter("db-1", "Shop", "database")],
            jobs: [job({ encryptionProfileId: "key-gone" })],
        }), "OVERWRITE");

        expect(firstCall(prismaMock.job.upsert)).toMatchObject({ encryptionProfileId: null, enabled: false });
        expect(result.notes).toEqual(["1 job is paused so it does not back up unencrypted, its encryption key is not here: Shop nightly."]);
    });

    it("names the jobs that lose a naming template or a schedule preset the file does not hold", async () => {
        const result = await importConfiguration(backup({
            adapters: [adapter("db-1", "Shop", "database")],
            jobs: [job({ namingTemplateId: "names-gone", schedulePresetId: "preset-gone" })],
        }), "OVERWRITE");

        expect(firstCall(prismaMock.job.upsert)).toMatchObject({ namingTemplateId: null, schedulePresetId: null });
        expect(result.notes).toEqual([
            "1 job uses the default file names, since the file holds no naming templates: Shop nightly.",
            "1 job runs on its own schedule, since the file holds no schedule presets: Shop nightly.",
        ]);
    });

    it("names the jobs whose database connection is not here", async () => {
        const result = await importConfiguration(backup({ jobs: [job({ sourceId: "db-gone" })] }), "OVERWRITE");

        expect(firstCall(prismaMock.job.upsert)).toMatchObject({ sourceId: null });
        expect(result.notes).toEqual(["1 job has no database to back up, its connection is not here: Shop nightly."]);
    });

    it("names a folder job that comes back without its folders, and not one that still has them here", async () => {
        prismaMock.jobSource.count.mockResolvedValueOnce(0).mockResolvedValueOnce(2);

        const result = await importConfiguration(backup({
            jobs: [job({ id: "job-web", name: "Web files", sourceId: null }), job({ id: "job-docs", name: "Documents", sourceId: null })],
        }), "OVERWRITE");

        expect(result.notes).toEqual(["1 job backs up no folders until it gets them again, since the file holds no folders: Web files."]);
    });

    it("switches the second factor off for a user whose second factor the file does not hold", async () => {
        prismaMock.passkey.count.mockResolvedValue(0);

        const result = await importConfiguration(backup({
            users: [{ id: "u-1", email: "anna@example.ch", name: "Anna", groupId: null, twoFactorEnabled: true, passkeyTwoFactor: true, accounts: [] }],
        }), "OVERWRITE");

        expect(prismaMock.user.update).toHaveBeenCalledWith({ where: { id: "u-1" }, data: { twoFactorEnabled: false, passkeyTwoFactor: false } });
        expect(result.notes).toEqual(["1 user signs in without a second factor until they set it up again, since the file holds none: anna@example.ch."]);
    });

    it("keeps the second factor of a user who has it here", async () => {
        prismaMock.twoFactor.findUnique.mockResolvedValue({ id: "tf-1" } as never);

        const result = await importConfiguration(backup({
            users: [{ id: "u-1", email: "anna@example.ch", name: "Anna", groupId: null, twoFactorEnabled: true, accounts: [] }],
        }), "OVERWRITE");

        expect(prismaMock.user.update).not.toHaveBeenCalled();
        expect(result.notes).toEqual([]);
    });

    it("leaves out an API key whose user is not here", async () => {
        const result = await importConfiguration(backup({
            apiKeys: [{ id: "key-1", name: "CI", hashedKey: "hash", userId: "u-gone" }],
        }), "OVERWRITE");

        expect(prismaMock.apiKey.upsert).not.toHaveBeenCalled();
        expect(result.notes).toEqual(["1 API key was left out, since the user it belongs to is not here."]);
    });

    it("changes nothing and says nothing when every link is here, like a restore onto the same DBackup", async () => {
        prismaMock.retentionPolicy.findUnique.mockResolvedValue({ id: "policy-1" } as never);
        prismaMock.namingTemplate.findUnique.mockResolvedValue({ id: "names-1" } as never);
        prismaMock.encryptionProfile.findUnique.mockResolvedValue({ id: "key-1" } as never);

        const result = await importConfiguration(backup({
            adapters: [adapter("db-1", "Shop", "database"), adapter("nas", "NAS")],
            jobs: [job({ encryptionProfileId: "key-1", namingTemplateId: "names-1" })],
            jobDestinations: [destination({ retentionPolicyId: "policy-1" })],
        }), "OVERWRITE");

        expect(firstCall(prismaMock.job.upsert)).toMatchObject({ enabled: true, encryptionProfileId: "key-1", namingTemplateId: "names-1" });
        expect(firstCall(prismaMock.jobDestination.upsert)).toMatchObject({ retentionPolicyId: "policy-1", retention: "{}" });
        expect(result.notes).toEqual([]);
    });
});
