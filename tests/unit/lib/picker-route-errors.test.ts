// @vitest-environment node
/**
 * The database list and the folder browse of a saved connection answer what its server said, like
 * a refused login or a folder that is not there, since that is what the picker has to show. A
 * refusal answers as a refusal, and a failure of DBackup itself, like one of its own database,
 * stays in the log behind a fixed sentence instead of naming a path of the server.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PermissionError, ValidationError } from "@/lib/logging/errors";
import { AdapterAnswerError, asAdapterAnswer } from "@/lib/adapters/adapter-answer";

const mocks = vi.hoisted(() => ({
    listSourceDatabases: vi.fn(),
    browseSavedFolders: vi.fn(),
}));

const CTX = { userId: "lena", tenantId: "default", allTenants: false, isPlatformAdmin: false, permissions: ["sources:view", "destinations:read", "jobs:write"], authMethod: "session" };

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth/access-control", () => ({
    getAuthContext: async () => CTX,
    checkPermissionWithContext: (ctx: typeof CTX, permission: string) => {
        if (!ctx.permissions.includes(permission)) throw new PermissionError(permission);
    },
    checkAnyPermissionWithContext: vi.fn(),
}));
vi.mock("@/lib/adapters", () => ({ registerAdapters: vi.fn() }));
vi.mock("@/lib/logging/logger", () => ({ logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) } }));
vi.mock("@/services/adapters/adapter-list", () => ({ getSavedConnection: async (id: string) => ({ id, adapterId: "sftp" }) }));
vi.mock("@/services/databases/databases-read-audit", () => ({ auditedDatabasesRead: (_ctx: unknown, _target: unknown, read: () => unknown) => read() }));
vi.mock("@/services/databases/database-read-service", () => ({ listSourceDatabases: (...args: unknown[]) => mocks.listSourceDatabases(...args) }));
vi.mock("@/services/adapters/location-browse-service", () => ({
    browseSavedFolders: (...args: unknown[]) => mocks.browseSavedFolders(...args),
    savedConnectionReachesHost: async () => false,
    HOST_FOLDER_PICKERS: [],
}));

const { GET: databases } = await import("@/app/api/adapters/[id]/databases/route");
const { GET: browse } = await import("@/app/api/adapters/[id]/browse/route");

const params = { params: Promise.resolve({ id: "conn-1" }) };
const request = new NextRequest("http://localhost/api/adapters/conn-1/browse?path=www");
const INTERNAL = new Error("SQLITE_BUSY: database is locked at /app/data/dbackup.db");

async function answer(response: Response) {
    return { status: response.status, body: await response.json() };
}

describe("what the pickers of a saved connection answer when the read fails", () => {
    beforeEach(() => vi.clearAllMocks());

    it("passes what the server said", async () => {
        mocks.listSourceDatabases.mockRejectedValue(new AdapterAnswerError("mysql", "list databases", "Access denied for user 'shop'"));
        mocks.browseSavedFolders.mockRejectedValue(new AdapterAnswerError("sftp", "browse", "No such file"));

        expect(await answer(await databases(request, params))).toEqual({ status: 500, body: { success: false, error: "Access denied for user 'shop'" } });
        expect(await answer(await browse(request, params))).toEqual({ status: 500, body: { success: false, error: "No such file" } });
    });

    it("answers a refusal as one", async () => {
        mocks.listSourceDatabases.mockRejectedValue(new ValidationError("This tenant may not reach the local network."));
        mocks.browseSavedFolders.mockRejectedValue(new ValidationError("This tenant may not reach the local network."));

        expect((await databases(request, params)).status).toBe(400);
        expect((await browse(request, params)).status).toBe(400);
    });

    it("keeps a failure of DBackup itself in the log behind a fixed sentence", async () => {
        mocks.listSourceDatabases.mockRejectedValue(INTERNAL);
        mocks.browseSavedFolders.mockRejectedValue(INTERNAL);

        const listed = await answer(await databases(request, params));
        const browsed = await answer(await browse(request, params));

        expect(listed).toEqual({ status: 500, body: { success: false, error: "The databases could not be listed. The log of DBackup has the details." } });
        expect(browsed).toEqual({ status: 500, body: { success: false, error: "The folders could not be listed. The log of DBackup has the details." } });
    });

    it("counts what an adapter call threw as the answer of its server, and keeps the class of an error of DBackup", () => {
        const wrapped = asAdapterAnswer("sftp", "browse", new Error("Permission denied"));
        expect(wrapped).toBeInstanceOf(AdapterAnswerError);
        expect((wrapped as Error).message).toBe("Permission denied");
        const refusal = new ValidationError("No.");
        expect(asAdapterAnswer("sftp", "browse", refusal)).toBe(refusal);
    });
});
