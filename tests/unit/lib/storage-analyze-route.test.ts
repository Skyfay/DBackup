import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/adapters", () => ({
    registerAdapters: vi.fn(),
}));

const mockGetAuthContext = vi.fn();
const mockCheckPermissionWithContext = vi.fn();
vi.mock("@/lib/auth/access-control", () => ({
    getAuthContext: (...args: any[]) => mockGetAuthContext(...args),
    checkPermissionWithContext: (...args: any[]) => mockCheckPermissionWithContext(...args),
}));

vi.mock("next/headers", () => ({
    headers: vi.fn().mockResolvedValue(new Headers()),
}));

vi.mock("@/lib/auth/permissions", () => ({
    PERMISSIONS: {
        STORAGE: { RESTORE: "storage:restore" },
    },
}));

const mockFindUnique = vi.fn();
vi.mock("@/lib/prisma", () => ({
    default: {
        adapterConfig: {
            findUnique: (...args: any[]) => mockFindUnique(...args),
        },
    },
}));

const mockResolveAdapterConfig = vi.fn();
vi.mock("@/lib/adapters/config-resolver", () => ({
    resolveAdapterConfig: (...args: any[]) => mockResolveAdapterConfig(...args),
}));

const mockDownload = vi.fn();
const mockRead = vi.fn();
const mockRegistryGet = vi.fn();
vi.mock("@/lib/core/registry", () => ({
    registry: { get: (...args: any[]) => mockRegistryGet(...args) },
}));

const mockReadManifestVersion = vi.fn();
const mockReadCombinedManifest = vi.fn();
vi.mock("@/lib/adapters/database/common/tar-utils", () => ({
    readManifestVersion: (...args: any[]) => mockReadManifestVersion(...args),
    readCombinedManifest: (...args: any[]) => mockReadCombinedManifest(...args),
}));

vi.mock("@/lib/temp-dir", () => ({
    getTempDir: () => "/tmp/dbackup-test",
}));

vi.mock("fs", () => ({
    default: {
        promises: { unlink: vi.fn().mockResolvedValue(undefined) },
    },
}));

const { POST } = await import("@/app/api/storage/[id]/analyze/route");

function createRequest(body: unknown) {
    return new NextRequest("http://localhost:3000/api/storage/dest-1/analyze", {
        method: "POST",
        body: JSON.stringify(body),
    });
}

function createProps(id = "dest-1") {
    return { params: Promise.resolve({ id }) };
}

describe("POST /api/storage/[id]/analyze - combined (manifest v2) archives", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetAuthContext.mockResolvedValue({ userId: "user-1" });
        mockResolveAdapterConfig.mockImplementation(async (config: unknown) => config);
        mockFindUnique.mockResolvedValue({ id: "dest-1", type: "storage", adapterId: "local-filesystem", config: "{}" });
        mockRegistryGet.mockReturnValue({ id: "local-filesystem", type: "storage", download: mockDownload, read: mockRead });
        mockDownload.mockResolvedValue(true);
        // No sidecar metadata by default - forces the full download + manifest-read path.
        mockRead.mockRejectedValue(new Error("not found"));
    });

    it("skips the sidecar shortcut and reads the full manifest when the sidecar itself reports directory sources", async () => {
        mockRead.mockResolvedValue(JSON.stringify({ combined: { databases: 1, directorySources: 2 }, sourceType: "mysql" }));
        mockReadManifestVersion.mockResolvedValue(2);
        mockReadCombinedManifest.mockResolvedValue({
            version: 2,
            sourceType: "mysql",
            entries: [
                { kind: "database", name: "db1", filename: "databases/db1.sql", size: 100, format: "sql" },
                { kind: "directory", jobSourceId: "src-1", label: "SFTP: /var/www", pathPrefix: "sources/src-1", fileCount: 12, totalSize: 4096, excludePatterns: [] },
            ],
        });

        const res = await POST(createRequest({ file: "backups/job1/archive.tar", type: undefined }), createProps());
        const body = await res.json();

        expect(body.databases).toEqual(["db1"]);
        expect(body.directories).toEqual([
            { jobSourceId: "src-1", label: "SFTP: /var/www", fileCount: 12, totalSize: 4096, excludePatterns: [] },
        ]);
        expect(body.sourceType).toBe("mysql");
    });

    it("omits sourceType for a directory-only combined archive", async () => {
        mockReadManifestVersion.mockResolvedValue(2);
        mockReadCombinedManifest.mockResolvedValue({
            version: 2,
            sourceType: "directory-only",
            entries: [
                { kind: "directory", jobSourceId: "src-1", label: "SFTP: /var/www", pathPrefix: "sources/src-1", fileCount: 3, totalSize: 100, excludePatterns: [] },
            ],
        });

        const res = await POST(createRequest({ file: "backups/job1/archive.tar" }), createProps());
        const body = await res.json();

        expect(body.databases).toEqual([]);
        expect(body.directories).toHaveLength(1);
        expect(body.sourceType).toBeUndefined();
    });

    it("falls back to the legacy database-only heuristic for a v1 archive", async () => {
        mockReadManifestVersion.mockResolvedValue(1);
        const mockAnalyzeDump = vi.fn().mockResolvedValue(["legacy_db"]);
        mockRegistryGet.mockImplementation((id: string) => {
            if (id === "local-filesystem") return { id, type: "storage", download: mockDownload, read: mockRead };
            if (id === "mysql") return { id, type: "database", analyzeDump: mockAnalyzeDump };
            return undefined;
        });

        const res = await POST(createRequest({ file: "backups/job1/dump.sql", type: "mysql" }), createProps());
        const body = await res.json();

        expect(body.databases).toEqual(["legacy_db"]);
        expect(body.directories).toBeUndefined();
    });
});
