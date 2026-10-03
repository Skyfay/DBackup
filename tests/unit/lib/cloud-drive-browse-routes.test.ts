import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { AuthenticationError, PermissionError } from "@/lib/logging/errors";

const mocks = vi.hoisted(() => ({
    checkPermission: vi.fn(),
    filesListFolder: vi.fn(),
    graphGet: vi.fn(),
    /** The paths the OneDrive route asked Microsoft Graph for. */
    graphPaths: [] as string[],
}));

vi.mock("@/lib/auth/access-control", () => ({ checkPermission: (...args: unknown[]) => mocks.checkPermission(...args) }));
vi.mock("@/services/auth/credential-service", () => ({
    getDecryptedCredentialData: vi.fn(async () => ({ clientId: "id", clientSecret: "secret", refreshToken: "token" })),
}));
vi.mock("dropbox", () => ({
    Dropbox: class {
        filesListFolder = mocks.filesListFolder;
        filesListFolderContinue = vi.fn();
    },
}));
vi.mock("@microsoft/microsoft-graph-client", () => {
    class GraphRequest {
        select() { return this; }
        filter() { return this; }
        top() { return this; }
        orderby() { return this; }
        get() { return mocks.graphGet(); }
    }
    return {
        Client: {
            init: () => ({
                api: (path: string) => {
                    mocks.graphPaths.push(path);
                    return new GraphRequest();
                },
            }),
        },
    };
});
vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

import { POST as browseDropbox } from "@/app/api/system/filesystem/dropbox/route";
import { POST as browseOneDrive } from "@/app/api/system/filesystem/onedrive/route";

const request = (drive: string, body: unknown) => new NextRequest(`http://localhost/api/system/filesystem/${drive}`, { method: "POST", body: JSON.stringify(body) });

/** Paths that a URL resolves out of the folder they name, which only the OneDrive route puts into one. */
const STEPPING_OUT = ["Backups/../../users/someone", "Backups/%2e%2E/x", "Backups\\..\\x", "./Backups", "Backups\u0000"];

beforeEach(() => {
    vi.clearAllMocks();
    mocks.graphPaths.length = 0;
    mocks.checkPermission.mockResolvedValue(undefined);
    // The access token of the OneDrive route.
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ access_token: "access" }) })));
});

describe("POST /api/system/filesystem/dropbox", () => {
    it("lists the folders of a Dropbox folder", async () => {
        mocks.filesListFolder.mockResolvedValue({
            result: {
                entries: [{ ".tag": "folder", name: "prod", path_display: "/Backups/prod" }, { ".tag": "file", name: "notes.txt", path_display: "/Backups/notes.txt" }],
                has_more: false,
            },
        });

        const response = await browseDropbox(request("dropbox", { credentialId: "oauth", folderPath: "/Backups" }));

        expect((await response.json()).data.entries).toEqual([{ name: "prod", type: "directory", path: "/Backups/prod" }]);
        expect(mocks.filesListFolder).toHaveBeenCalledWith(expect.objectContaining({ path: "/Backups" }));
    });

    it("turns down a path with a . or .. part and a body without a credential profile", async () => {
        for (const body of [...STEPPING_OUT.map((folderPath) => ({ credentialId: "oauth", folderPath })), { folderPath: "/Backups" }, { credentialId: "oauth", folderPath: 42 }]) {
            expect((await browseDropbox(request("dropbox", body))).status).toBe(400);
        }
        expect(mocks.filesListFolder).not.toHaveBeenCalled();
    });
});

describe("POST /api/system/filesystem/onedrive", () => {
    it("lists the folders of a OneDrive folder, dots within a name included", async () => {
        mocks.graphGet.mockResolvedValue({ value: [{ name: "prod", folder: {} }] });

        const response = await browseOneDrive(request("onedrive", { credentialId: "oauth", folderPath: "/Backups/v1.2/.dbackup" }));

        expect((await response.json()).data.entries).toEqual([{ name: "prod", type: "directory", path: "Backups/v1.2/.dbackup/prod" }]);
        expect(mocks.graphPaths).toEqual(["/me/drive/root:/Backups/v1.2/.dbackup:/children"]);
    });

    it("turns down a path a URL would resolve out of the drive, before it asks for a token", async () => {
        for (const folderPath of STEPPING_OUT) {
            expect((await browseOneDrive(request("onedrive", { credentialId: "oauth", folderPath }))).status).toBe(400);
        }
        expect(fetch).not.toHaveBeenCalled();
        expect(mocks.graphPaths).toEqual([]);
    });
});

describe("the login and permission of the cloud drive routes", () => {
    it("needs the right to change destinations, since only the connection form browses a drive", async () => {
        mocks.filesListFolder.mockResolvedValue({ result: { entries: [], has_more: false } });
        mocks.graphGet.mockResolvedValue({ value: [] });

        expect((await browseDropbox(request("dropbox", { credentialId: "oauth" }))).status).toBe(200);
        expect((await browseOneDrive(request("onedrive", { credentialId: "oauth" }))).status).toBe(200);
        expect(mocks.checkPermission.mock.calls).toEqual([[PERMISSIONS.DESTINATIONS.WRITE], [PERMISSIONS.DESTINATIONS.WRITE]]);
    });

    it("answers a missing login with 401 and a missing permission with 403", async () => {
        mocks.checkPermission.mockRejectedValueOnce(new AuthenticationError());
        expect((await browseDropbox(request("dropbox", { credentialId: "oauth" }))).status).toBe(401);

        mocks.checkPermission.mockRejectedValueOnce(new PermissionError(PERMISSIONS.DESTINATIONS.WRITE));
        expect((await browseOneDrive(request("onedrive", { credentialId: "oauth" }))).status).toBe(403);

        expect(mocks.filesListFolder).not.toHaveBeenCalled();
        expect(fetch).not.toHaveBeenCalled();
    });
});
