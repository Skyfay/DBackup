import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { EncryptionKeyRequiredError } from "@/lib/logging/errors";

vi.mock("@/lib/adapters", () => ({
    registerAdapters: vi.fn(),
}));

const mockGetAuthContext = vi.fn();
const mockCheckAnyPermissionWithContext = vi.fn();
vi.mock("@/lib/auth/access-control", () => ({
    getAuthContext: (...args: any[]) => mockGetAuthContext(...args),
    checkAnyPermissionWithContext: (...args: any[]) => mockCheckAnyPermissionWithContext(...args),
}));

vi.mock("next/headers", () => ({
    headers: vi.fn().mockResolvedValue(new Headers()),
}));

vi.mock("@/lib/auth/permissions", () => ({
    PERMISSIONS: {
        STORAGE: { RESTORE: "storage:restore", DOWNLOAD: "storage:download" },
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

const mockSummarize = vi.fn();
const mockSummarizeFromArchive = vi.fn();
vi.mock("@/services/backup/archive-index-service", () => ({
    archiveIndexService: {
        summarize: (...args: any[]) => mockSummarize(...args),
        summarizeFromArchive: (...args: any[]) => mockSummarizeFromArchive(...args),
    },
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

    it("accepts either the restore or the download permission, since listing is read-only", async () => {
        mockRead.mockResolvedValue(JSON.stringify({ databases: { names: ["shop"] } }));

        await POST(createRequest({ file: "backups/job1/shop.sql" }), createProps());

        expect(mockCheckAnyPermissionWithContext).toHaveBeenCalledWith(
            expect.anything(),
            ["storage:restore", "storage:download"]
        );
    });

    it("answers from the index sidecar without downloading the archive", async () => {
        // This is the whole point of the sidecar: listing a backup's contents must not
        // cost a download of the backup.
        mockRead.mockResolvedValue(JSON.stringify({
            archive: { formatVersion: 2, indexFile: ".index", encrypted: false },
            combined: { databases: 1, directorySources: 1 },
            sourceType: "mysql",
        }));
        mockSummarize.mockResolvedValue({
            databases: ["db1"],
            directories: [{ jobSourceId: "src-1", label: "SFTP: /var/www", fileCount: 12, totalSize: 4096, excludePatterns: [] }],
            sourceType: "mysql",
        });

        const res = await POST(createRequest({ file: "backups/job1/archive.tar", type: undefined }), createProps());
        const body = await res.json();

        expect(body.databases).toEqual(["db1"]);
        expect(body.directories).toEqual([
            { jobSourceId: "src-1", label: "SFTP: /var/www", fileCount: 12, totalSize: 4096, excludePatterns: [] },
        ]);
        expect(body.sourceType).toBe("mysql");
        expect(mockDownload).not.toHaveBeenCalled();
    });

    it("omits sourceType for a directory-only combined archive", async () => {
        mockRead.mockResolvedValue(JSON.stringify({
            archive: { formatVersion: 2, indexFile: ".index", encrypted: true, profileId: "p1", kdfSalt: "00", noncePrefix: "01" },
            combined: { databases: 0, directorySources: 1 },
            sourceType: "directory-only",
        }));
        mockSummarize.mockResolvedValue({
            databases: [],
            directories: [{ jobSourceId: "src-1", label: "SFTP: /var/www", fileCount: 3, totalSize: 100, excludePatterns: [] }],
            sourceType: undefined,
        });

        const res = await POST(createRequest({ file: "backups/job1/archive.tar" }), createProps());
        const body = await res.json();

        expect(body.databases).toEqual([]);
        expect(body.directories).toHaveLength(1);
        expect(body.sourceType).toBeUndefined();
    });

    it("falls back to the full download when the sidecar is unreadable", async () => {
        // A missing or corrupt sidecar must degrade to the old path, not fail the listing.
        mockRead.mockResolvedValue(JSON.stringify({
            archive: { formatVersion: 2, indexFile: ".index", encrypted: false },
            sourceType: "mysql",
        }));
        mockSummarize.mockResolvedValue(null);
        // The embedded index member is the disaster fallback, and it must still report the
        // directory sources - the legacy database-only shortcuts would have dropped them.
        mockSummarizeFromArchive.mockResolvedValue({
            databases: ["db1"],
            directories: [{ jobSourceId: "src-1", label: "SFTP: /var/www", fileCount: 4, totalSize: 900, excludePatterns: [] }],
            sourceType: "mysql",
        });

        const res = await POST(createRequest({ file: "backups/job1/archive.tar", type: "mysql" }), createProps());
        const body = await res.json();

        expect(mockDownload).toHaveBeenCalled();
        expect(body.databases).toEqual(["db1"]);
        expect(body.directories).toHaveLength(1);
    });

    it("falls back to the legacy database-only heuristic for a v1 archive", async () => {
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

    it("opens the backup with the profile the user picked after being asked", async () => {
        // The answer to a key prompt has to reach the server, or choosing a profile does
        // nothing and the same prompt comes straight back.
        mockRead.mockResolvedValue(JSON.stringify({
            archive: { formatVersion: 2, indexFile: ".index", encrypted: true, profileId: "gone", kdfSalt: "00", noncePrefix: "01" },
            sourceType: "directory-only",
        }));
        mockSummarize.mockResolvedValue({ databases: [], directories: [], sourceType: undefined });

        await POST(
            createRequest({ file: "backups/job1/archive.tar", profileIdOverride: "picked-by-user" }),
            createProps()
        );

        expect(mockSummarize).toHaveBeenCalledWith(
            "dest-1", "backups/job1/archive.tar", expect.anything(), { profileId: "picked-by-user" }
        );
    });

    it("asks for a key instead of reporting an archive nobody can open as empty", async () => {
        // The regression: the metadata block's own catch swallowed this, so the route
        // downloaded the whole archive to fail again on the same key, then answered 200
        // with no databases and no directories - which the page rendered as a blank form.
        mockRead.mockResolvedValue(JSON.stringify({
            archive: { formatVersion: 2, indexFile: ".index", encrypted: true, profileId: "gone", kdfSalt: "00", noncePrefix: "01" },
            sourceType: "directory-only",
        }));
        mockSummarize.mockRejectedValue(new EncryptionKeyRequiredError("no key fits", "gone"));

        const res = await POST(createRequest({ file: "backups/job1/archive.tar" }), createProps());
        const body = await res.json();

        expect(res.status).toBe(422);
        expect(body.code).toBe("ENCRYPTION_KEY_REQUIRED");
        expect(body.profileId).toBe("gone");
        expect(mockDownload).not.toHaveBeenCalled();
    });
});
