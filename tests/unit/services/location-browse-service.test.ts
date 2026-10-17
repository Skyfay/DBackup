import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AdapterConfig } from "@prisma/client";
import { runAsTenant } from "@/lib/tenant/context";
import { HOME_TENANT_ID } from "@/lib/tenant/home";

const mocks = vi.hoisted(() => ({
    get: vi.fn(),
    applyStoredSecrets: vi.fn(),
    overlayCredentialsOnConfig: vi.fn(),
    resolveAdapterConfig: vi.fn(),
    browseDirectories: vi.fn(),
    isShared: vi.fn(),
    viewModeOf: vi.fn(),
}));

vi.mock("@/lib/core/registry", () => ({ registry: { get: (...args: unknown[]) => mocks.get(...args) } }));
vi.mock("@/lib/adapters/config-resolver", () => ({
    applyStoredSecrets: (...args: unknown[]) => mocks.applyStoredSecrets(...args),
    overlayCredentialsOnConfig: (...args: unknown[]) => mocks.overlayCredentialsOnConfig(...args),
    resolveAdapterConfig: (...args: unknown[]) => mocks.resolveAdapterConfig(...args),
}));
vi.mock("@/services/sharing/destination-access", () => ({
    isShared: (...args: unknown[]) => mocks.isShared(...args),
    viewModeOf: (...args: unknown[]) => mocks.viewModeOf(...args),
    viewerOf: async (row: { tenantId: string }) => row.tenantId,
}));

import { browseLocation, browseSavedFolders } from "@/services/adapters/location-browse-service";

describe("browseLocation", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.get.mockReturnValue({ browseDirectories: mocks.browseDirectories });
        mocks.applyStoredSecrets.mockImplementation(async (_id: string, _configId: string, config: object) => ({ ...config, password: "stored" }));
        mocks.overlayCredentialsOnConfig.mockImplementation(async (_id: string, config: object) => ({ ...config, username: "backup" }));
        mocks.browseDirectories.mockResolvedValue([{ name: "srv", path: "srv" }]);
        mocks.isShared.mockResolvedValue(false);
    });

    it("refuses the folder of a saved destination shared with other tenants, whose top holds the folders of its customers", async () => {
        mocks.isShared.mockResolvedValue(true);

        await expect(browseLocation({ adapterId: "s3-aws", config: { bucket: "company" }, storedConfigId: "shared", path: "" }))
            .rejects.toThrow("It is shared with other tenants");
        expect(mocks.applyStoredSecrets).not.toHaveBeenCalled();
        expect(mocks.browseDirectories).not.toHaveBeenCalled();
    });

    it("refuses rsync options of a customer that would run on the server DBackup runs on, and lets the platform use them", async () => {
        const input = { adapterId: "rsync", config: { host: "nas.local", authType: "password", password: "pw", options: "-e sh" }, path: "" };

        await expect(runAsTenant("acme", () => browseLocation(input))).rejects.toThrow("The rsync option -e reaches the server DBackup runs on");
        expect(mocks.browseDirectories).not.toHaveBeenCalled();

        await expect(runAsTenant(HOME_TENANT_ID, () => browseLocation(input))).resolves.toEqual([{ name: "srv", path: "srv" }]);
    });

    it("lists a server from its top with the login of the form, whatever folder the form holds", async () => {
        const entries = await browseLocation({ adapterId: "sftp", config: { host: "nas.local", pathPrefix: "/srv/backups" }, primaryCredentialId: "login", path: "" });

        expect(entries).toEqual([{ name: "srv", path: "srv" }]);
        expect(mocks.overlayCredentialsOnConfig).toHaveBeenCalledWith("sftp", { host: "nas.local", pathPrefix: "/srv/backups" }, "login", null);
        expect(mocks.applyStoredSecrets).not.toHaveBeenCalled();
        expect(mocks.browseDirectories).toHaveBeenCalledWith({ host: "nas.local", pathPrefix: "/", username: "backup" }, "");
    });

    it("lists a bucket within itself and hands on the level asked for", async () => {
        await browseLocation({ adapterId: "s3-aws", config: { bucket: "company" }, path: "backups" });

        expect(mocks.browseDirectories).toHaveBeenCalledWith({ bucket: "company", pathPrefix: "", username: "backup" }, "backups");
    });

    it("fills in the saved secrets of the connection being edited", async () => {
        await browseLocation({ adapterId: "smb", config: { address: "//nas/backup" }, storedConfigId: "saved", path: "" });

        expect(mocks.applyStoredSecrets).toHaveBeenCalledWith("smb", "saved", { address: "//nas/backup" });
        expect(mocks.browseDirectories.mock.calls[0][0]).toMatchObject({ password: "stored" });
    });

    it("refuses a storage whose folder is picked another way", async () => {
        await expect(browseLocation({ adapterId: "google-drive", config: {}, path: "" })).rejects.toThrow("This connection cannot browse its folders.");
        expect(mocks.browseDirectories).not.toHaveBeenCalled();
    });

    it("gives up on a storage that does not answer, with a sentence instead of a spinner", async () => {
        vi.useFakeTimers();
        mocks.browseDirectories.mockReturnValue(new Promise(() => undefined));

        const listing = browseLocation({ adapterId: "ftp", config: { host: "ftp.local" }, path: "" });
        const expectation = expect(listing).rejects.toThrow("The storage did not answer within 15 seconds.");
        await vi.advanceTimersByTimeAsync(15_000);
        await expectation;
        vi.useRealTimers();
    });
});

describe("browseSavedFolders", () => {
    const saved = { id: "nas", tenantId: "msp", adapterId: "sftp", type: "storage", config: "{}" } as unknown as AdapterConfig;

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.get.mockReturnValue({ id: "sftp", browseDirectories: mocks.browseDirectories });
        mocks.resolveAdapterConfig.mockResolvedValue({ host: "nas.local", pathPrefix: "/backups" });
        mocks.browseDirectories.mockResolvedValue([{ name: "tenants", path: "tenants" }, { name: "shop", path: "shop" }]);
    });

    it("lists the folders of a storage nobody shares", async () => {
        mocks.viewModeOf.mockResolvedValue({ kind: "own" });

        expect(await browseSavedFolders(saved, "")).toEqual([{ name: "tenants", path: "tenants" }, { name: "shop", path: "shop" }]);
        expect(mocks.browseDirectories).toHaveBeenCalledWith({ host: "nas.local", pathPrefix: "/backups" }, "");
    });

    it("never lists a destination shared with other tenants, whose folders hold those of its customers", async () => {
        mocks.viewModeOf.mockResolvedValue({ kind: "provider" });

        expect(await browseSavedFolders(saved, "")).toBeNull();
        expect(mocks.browseDirectories).not.toHaveBeenCalled();
        expect(mocks.resolveAdapterConfig).not.toHaveBeenCalled();
    });

    it("never lists a storage the tenant may not use", async () => {
        mocks.viewModeOf.mockResolvedValue(null);

        expect(await browseSavedFolders(saved, "")).toBeNull();
        expect(mocks.browseDirectories).not.toHaveBeenCalled();
    });
});
