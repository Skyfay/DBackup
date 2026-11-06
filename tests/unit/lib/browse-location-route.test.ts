import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { PermissionError } from "@/lib/logging/errors";
import { assertSourceFolder } from "@/lib/archive/remote-paths";

const mocks = vi.hoisted(() => ({
    getAuthContext: vi.fn(),
    browseLocation: vi.fn(),
    logFor: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/adapters", () => ({ registerAdapters: vi.fn() }));
// The real checks, reduced to the permission list of the context.
vi.mock("@/lib/auth/access-control", () => ({
    getAuthContext: (...args: unknown[]) => mocks.getAuthContext(...args),
    checkPermissionWithContext: (ctx: { permissions: string[] }, permission: string) => {
        if (!ctx.permissions.includes(permission)) throw new PermissionError(permission);
    },
}));
vi.mock("@/services/adapters/location-browse-service", () => ({ browseLocation: (...args: unknown[]) => mocks.browseLocation(...args) }));
vi.mock("@/services/audit-service", () => ({ auditService: { logFor: mocks.logFor, log: vi.fn() } }));
// None of these connections is the destination of the configuration backup.
vi.mock("@/services/config/config-backup-targets", () => ({ getConfigBackupTargets: async () => ({ storageId: null, profileId: null, credentialIds: [] }) }));
vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

import { POST } from "@/app/api/adapters/browse-location/route";

const signedIn = (...permissions: string[]) => mocks.getAuthContext.mockResolvedValue({ userId: "u1", permissions, isPlatformAdmin: false });
const request = (body: unknown) => new NextRequest("http://localhost/api/adapters/browse-location", { method: "POST", body: JSON.stringify(body) });
const SFTP = { adapterId: "sftp", config: { host: "nas.local" }, primaryCredentialId: "login", path: "srv" };

describe("POST /api/adapters/browse-location", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.browseLocation.mockResolvedValue([{ name: "backups", path: "srv/backups" }]);
    });

    it("turns away a request without a session", async () => {
        mocks.getAuthContext.mockResolvedValue(null);
        expect((await POST(request(SFTP))).status).toBe(401);
    });

    it("needs the right to change storage connections, since it logs in with what the form holds", async () => {
        signedIn(PERMISSIONS.DESTINATIONS.READ);
        expect((await POST(request(SFTP))).status).toBe(403);
        expect(mocks.browseLocation).not.toHaveBeenCalled();
    });

    it("lists one level of the folders of the connection in the form", async () => {
        signedIn(PERMISSIONS.DESTINATIONS.WRITE);
        const response = await POST(request({ ...SFTP, configId: "saved" }));

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ success: true, data: { path: "srv", entries: [{ name: "backups", path: "srv/backups" }] } });
        expect(mocks.browseLocation).toHaveBeenCalledWith({ adapterId: "sftp", config: { host: "nas.local" }, storedConfigId: "saved", primaryCredentialId: "login", path: "srv" });
    });

    it("answers 400 to a path that climbs above the top of the storage, and writes no entry for it", async () => {
        signedIn(PERMISSIONS.DESTINATIONS.WRITE);
        // The guard of the service, which refuses the path before anything is dialed.
        mocks.browseLocation.mockImplementation(async (input: { path: string }) => {
            assertSourceFolder(input.path);
            return [];
        });

        const response = await POST(request({ ...SFTP, path: "../.." }));

        expect(response.status).toBe(400);
        expect((await response.json()).error).toContain("leaves the folder of its connection");
        expect(mocks.logFor).not.toHaveBeenCalled();
    });

    it("refuses a connection whose folder is picked another way, and a request it cannot read", async () => {
        signedIn(PERMISSIONS.DESTINATIONS.WRITE, PERMISSIONS.SOURCES.WRITE);
        expect((await POST(request({ ...SFTP, adapterId: "google-drive" }))).status).toBe(400);
        expect((await POST(request({ ...SFTP, adapterId: "mysql" }))).status).toBe(400);
        expect((await POST(request({ adapterId: "sftp" }))).status).toBe(400);
        expect((await POST(request({ ...SFTP, path: "a\u0000b" }))).status).toBe(400);
        expect(mocks.browseLocation).not.toHaveBeenCalled();
    });

    it("says the storage could not be listed, while the error of the server goes to the log", async () => {
        signedIn(PERMISSIONS.DESTINATIONS.WRITE);
        mocks.browseLocation.mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.7:22"));

        const response = await POST(request(SFTP));
        const body = await response.json();
        expect(response.status).toBe(502);
        expect(body.success).toBe(false);
        expect(body.error).toMatch(/^The folders could not be listed\./);
        expect(body.error).not.toContain("ECONNREFUSED");
    });
});
