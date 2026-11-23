import { beforeEach, describe, expect, it, vi } from "vitest";
import { ValidationError } from "@/lib/logging/errors";

const mocks = vi.hoisted(() => ({
    logFor: vi.fn(),
    connectionPlace: vi.fn(),
    credentialPlace: vi.fn(),
}));

vi.mock("@/services/audit-service", () => ({ auditService: { logFor: mocks.logFor } }));
vi.mock("@/services/audit/record-names", () => ({
    connectionPlace: (...args: unknown[]) => mocks.connectionPlace(...args),
    credentialPlace: (...args: unknown[]) => mocks.credentialPlace(...args),
}));
vi.mock("@/lib/adapters/dialed-hosts", () => ({ dialedHosts: () => [], hostOf: () => null }));

import { auditedProbe, logProbe, type ProbeAction } from "@/services/adapters/probe-audit";

/** A platform admin in All tenants, where no tenant runs. */
const admin = { userId: "admin", authMethod: "session" as const };

describe("the log a look at a saved record goes into", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.connectionPlace.mockImplementation(async (id: string) => (id === "nas-globex" ? { name: "Globex NAS", tenantId: "globex" } : null));
        mocks.credentialPlace.mockImplementation(async (id: string) => (id === "drive-login" ? { name: "Globex Drive", tenantId: "globex" } : null));
    });

    it.each<ProbeAction>(["folder_browse", "volume_list", "volume_sizes", "path_check", "storage_check"])(
        "keeps a %s of a connection of a customer in the log of that customer, also from All tenants",
        async (action) => {
            await logProbe(admin, action, { record: { id: "nas-globex", name: "Globex NAS" } }, true);

            expect(mocks.logFor).toHaveBeenCalledExactlyOnceWith(admin, "EXECUTE", "ADAPTER", expect.objectContaining({ action, name: "Globex NAS" }), "nas-globex", { tenantId: "globex" });
            expect(mocks.connectionPlace).toHaveBeenCalledWith("nas-globex");
        },
    );

    it("keeps a check of the token of a saved login in the log of the tenant of that login", async () => {
        await logProbe(admin, "token_check", { adapterId: "google-drive", record: { id: "drive-login", name: "Globex Drive" } }, false);

        expect(mocks.logFor).toHaveBeenCalledExactlyOnceWith(admin, "EXECUTE", "CREDENTIAL", expect.objectContaining({ action: "token_check", success: false }), "drive-login", { tenantId: "globex" });
        expect(mocks.credentialPlace).toHaveBeenCalledWith("drive-login");
        expect(mocks.connectionPlace).not.toHaveBeenCalled();
    });

    it("leaves the tenant to the code that runs for a record the scope does not see", async () => {
        await logProbe(admin, "folder_browse", { record: { id: "unknown", name: null } }, true);

        expect(mocks.logFor).toHaveBeenCalledExactlyOnceWith(admin, "EXECUTE", "ADAPTER", expect.anything(), "unknown", { tenantId: undefined });
    });

    it("names no tenant for a look from a form, which is about no saved record", async () => {
        await logProbe(admin, "folder_browse", { adapterId: "sftp" }, true);

        expect(mocks.logFor).toHaveBeenCalledExactlyOnceWith(admin, "EXECUTE", "ADAPTER", { action: "folder_browse", adapter: "sftp", success: true });
        expect(mocks.connectionPlace).not.toHaveBeenCalled();
    });

    it("writes nothing for a look refused before it ran, and the tenant of the record for one that failed", async () => {
        const target = { record: { id: "nas-globex", name: "Globex NAS" } };

        await expect(auditedProbe(admin, "folder_browse", target, async () => { throw new ValidationError("The folder ../.. leaves the folder of its connection."); })).rejects.toThrow(ValidationError);
        expect(mocks.logFor).not.toHaveBeenCalled();

        await expect(auditedProbe(admin, "folder_browse", target, async () => { throw new Error("connection reset"); })).rejects.toThrow("connection reset");
        expect(mocks.logFor).toHaveBeenCalledExactlyOnceWith(admin, "EXECUTE", "ADAPTER", expect.objectContaining({ success: false }), "nas-globex", { tenantId: "globex" });
    });
});
