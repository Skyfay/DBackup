import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { AuthenticationError, PermissionError } from "@/lib/logging/errors";

const mocks = vi.hoisted(() => ({ get: vi.fn(), list: vi.fn(), checkPermission: vi.fn() }));

vi.mock("@/lib/auth/access-control", () => ({ checkPermission: (...args: unknown[]) => mocks.checkPermission(...args) }));
vi.mock("@/services/auth/credential-service", () => ({
    getDecryptedCredentialData: vi.fn(async () => ({ clientId: "id", clientSecret: "secret", refreshToken: "token" })),
}));
vi.mock("googleapis", () => ({
    google: {
        auth: { OAuth2: class { setCredentials() {} } },
        drive: () => ({ files: { get: mocks.get, list: mocks.list } }),
    },
}));
vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

import { POST } from "@/app/api/system/filesystem/google-drive/route";

const request = (body: unknown) => new NextRequest("http://localhost/api/system/filesystem/google-drive", { method: "POST", body: JSON.stringify(body) });

/** A drive whose folders know their parents, with ROOT as My Drive. A folder not in it cannot be read. */
function drive(folders: Record<string, { name: string; parents?: string[] }>) {
    mocks.get.mockImplementation(async ({ fileId }: { fileId: string }) => {
        if (fileId === "root") return { data: { id: "ROOT" } };
        if (!folders[fileId]) throw new Error("File not found");
        return { data: { id: fileId, ...folders[fileId] } };
    });
}

describe("POST /api/system/filesystem/google-drive", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.checkPermission.mockResolvedValue(undefined);
    });

    it("gives the folders from the top of My Drive down to a folder, for the picker to open there", async () => {
        drive({ "9XyZ": { name: "Restores", parents: ["1AbC"] }, "1AbC": { name: "Backups", parents: ["ROOT"] } });
        const response = await POST(request({ credentialId: "oauth", folderId: "9XyZ", trail: true }));

        expect(await response.json()).toEqual({ success: true, data: { trail: [{ name: "Backups", path: "1AbC" }, { name: "Restores", path: "9XyZ" }] } });
        expect(mocks.list).not.toHaveBeenCalled();
        expect(mocks.checkPermission).toHaveBeenCalledWith(PERMISSIONS.DESTINATIONS.WRITE);
    });

    it("ends the way at a shared folder whose parent the account cannot read", async () => {
        drive({ S1: { name: "Shared", parents: ["someone-elses"] } });
        const response = await POST(request({ credentialId: "oauth", folderId: "S1", trail: true }));

        expect((await response.json()).data.trail).toEqual([{ name: "Shared", path: "S1" }]);
    });

    it("gives no folders for My Drive itself", async () => {
        drive({});
        const response = await POST(request({ credentialId: "oauth", trail: true }));

        expect((await response.json()).data.trail).toEqual([]);
    });

    it("lists one level of folders without trail, like before", async () => {
        mocks.list.mockResolvedValue({ data: { files: [{ id: "1AbC", name: "Backups" }] } });
        const response = await POST(request({ credentialId: "oauth" }));

        expect((await response.json()).data.entries).toEqual([{ name: "Backups", type: "directory", path: "1AbC" }]);
    });

    it("turns down a folder ID Google could not have made, before it reaches a query", async () => {
        for (const body of [
            { credentialId: "oauth", folderId: "root' in parents or 'x" },
            { credentialId: "oauth", folderId: "root' in parents or 'x", trail: true },
            { credentialId: "oauth", folderId: "1AbC\u0000" },
        ]) {
            const response = await POST(request(body));
            expect(response.status).toBe(400);
        }
        expect(mocks.list).not.toHaveBeenCalled();
        expect(mocks.get).not.toHaveBeenCalled();
    });

    it("turns down a body it cannot read", async () => {
        for (const body of [{ folderId: "1AbC" }, { credentialId: "", folderId: "1AbC" }, { credentialId: "oauth", trail: "yes" }, "not json"]) {
            expect((await POST(request(body))).status).toBe(400);
        }
        expect(mocks.list).not.toHaveBeenCalled();
    });

    it("answers a missing login with 401 and a missing permission with 403", async () => {
        mocks.checkPermission.mockRejectedValueOnce(new AuthenticationError());
        expect((await POST(request({ credentialId: "oauth" }))).status).toBe(401);

        mocks.checkPermission.mockRejectedValueOnce(new PermissionError(PERMISSIONS.DESTINATIONS.WRITE));
        expect((await POST(request({ credentialId: "oauth" }))).status).toBe(403);
        expect(mocks.list).not.toHaveBeenCalled();
    });
});
