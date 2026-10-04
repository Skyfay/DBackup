import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    get: vi.fn(),
    applyStoredSecrets: vi.fn(),
    overlayCredentialsOnConfig: vi.fn(),
    browseDirectories: vi.fn(),
}));

vi.mock("@/lib/core/registry", () => ({ registry: { get: (...args: unknown[]) => mocks.get(...args) } }));
vi.mock("@/lib/adapters/config-resolver", () => ({
    applyStoredSecrets: (...args: unknown[]) => mocks.applyStoredSecrets(...args),
    overlayCredentialsOnConfig: (...args: unknown[]) => mocks.overlayCredentialsOnConfig(...args),
}));

import { browseLocation } from "@/services/adapters/location-browse-service";

describe("browseLocation", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.get.mockReturnValue({ browseDirectories: mocks.browseDirectories });
        mocks.applyStoredSecrets.mockImplementation(async (_id: string, _configId: string, config: object) => ({ ...config, password: "stored" }));
        mocks.overlayCredentialsOnConfig.mockImplementation(async (_id: string, config: object) => ({ ...config, username: "backup" }));
        mocks.browseDirectories.mockResolvedValue([{ name: "srv", path: "srv" }]);
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
