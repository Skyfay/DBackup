// @vitest-environment node
/**
 * What a route answers when something inside it broke: a fixed sentence, while the error itself,
 * which can name a path, a host or a line of a driver, goes to the log. A refusal written for the
 * user, like a selection that matches nothing, still says why.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ValidationError } from "@/lib/logging/errors";

/** The detail a failure must never hand to the caller. */
const DETAIL = "ECONNREFUSED 10.0.0.7:5432 /srv/dbackup/secret-path";

const mocks = vi.hoisted(() => ({
    getRunStatus: vi.fn(),
    deleteAdapter: vi.fn(),
    downloadFile: vi.fn(),
    restoreFilesToStorage: vi.fn(),
    openArchiveDownload: vi.fn(),
    consumeSelectionDownloadToken: vi.fn(),
    listFolder: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/logging/logger", () => ({ logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) } }));
vi.mock("@/lib/adapters", () => ({ registerAdapters: vi.fn() }));
vi.mock("@/lib/auth/access-control", () => ({
    getAuthContext: async () => ({ userId: "ada", tenantId: "default", allTenants: false, isPlatformAdmin: true, permissions: [], authMethod: "session" }),
    checkPermissionWithContext: vi.fn(),
    checkAnyPermissionWithContext: vi.fn(),
    hasPermissionWithContext: () => true,
    checkPermission: async () => ({ id: "ada", isPlatformAdmin: true, tenantId: "default" }),
}));
vi.mock("@/services/config/config-backup-targets", () => ({ getConfigBackupTargets: async () => ({ storageId: null, profileId: null, credentialIds: [] }) }));
vi.mock("@/services/storage/config-backup-access", () => ({ isConfigBackupFile: async () => false }));
vi.mock("@/services/history/run-status", () => ({ getRunStatus: mocks.getRunStatus }));
vi.mock("@/services/adapters/adapter-service", () => ({ deleteAdapter: mocks.deleteAdapter }));
vi.mock("@/services/adapters/adapter-list", () => ({ getAdapterType: async () => "storage" }));
vi.mock("@/services/adapters/adapter-update", () => ({ updateAdapter: vi.fn(), UnsupportedSettingError: class extends Error {} }));
vi.mock("@/services/storage/storage-service", () => ({ storageService: { downloadFile: mocks.downloadFile } }));
vi.mock("@/services/storage/backup-audit", () => ({
    backupAuditDetails: async (_id: string, file: string) => ({ file }),
    fileRestoreTarget: async () => ({}),
}));
vi.mock("@/services/restore/file-restore", () => ({ planFileRestore: vi.fn(), restoreFilesToStorage: mocks.restoreFilesToStorage }));
vi.mock("@/services/restore/archive-download", () => ({ planArchiveDownload: vi.fn(), openArchiveDownload: mocks.openArchiveDownload }));
vi.mock("@/lib/auth/download-tokens", () => ({
    generateSelectionDownloadToken: vi.fn(),
    consumeSelectionDownloadToken: mocks.consumeSelectionDownloadToken,
    generateFileDownloadToken: vi.fn(),
    consumeFileDownloadToken: vi.fn(),
    markTokenUsed: vi.fn(),
}));
vi.mock("@/services/audit-service", () => ({ auditService: { logFor: vi.fn(), log: vi.fn() } }));
vi.mock("@/services/auth/credential-service", () => ({ getDecryptedCredentialData: async () => ({ clientId: "id", clientSecret: "secret", refreshToken: "token" }) }));
vi.mock("dropbox", () => ({ Dropbox: class { filesListFolder = mocks.listFolder; } }));

const { GET: runStatus } = await import("@/app/api/executions/[id]/route");
const { DELETE: deleteConnection } = await import("@/app/api/adapters/[id]/route");
const download = await import("@/app/api/storage/[id]/download/route");
const restoreFiles = await import("@/app/api/storage/[id]/restore-files/route");
const { POST: browseDropbox } = await import("@/app/api/system/filesystem/dropbox/route");

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const errorOf = async (response: Response) => ((await response.json()) as { error?: string }).error ?? "";

beforeEach(() => {
    vi.clearAllMocks();
    const broken = new Error(DETAIL);
    mocks.getRunStatus.mockRejectedValue(broken);
    mocks.deleteAdapter.mockRejectedValue(broken);
    mocks.downloadFile.mockRejectedValue(broken);
    mocks.restoreFilesToStorage.mockRejectedValue(broken);
    mocks.openArchiveDownload.mockRejectedValue(broken);
    mocks.consumeSelectionDownloadToken.mockReturnValue({ storageId: "nas", file: "nightly/files.tar", selection: { fileName: "files.tar.gz" } });
    mocks.listFolder.mockRejectedValue(broken);
});

describe("a failure inside a route", () => {
    it("answers a fixed sentence and keeps the error for the log", async () => {
        const answers = await Promise.all([
            runStatus(new NextRequest("http://localhost/api/executions/run-1"), params("run-1")),
            deleteConnection(new NextRequest("http://localhost/api/adapters/nas", { method: "DELETE" }), params("nas")),
            download.GET(new NextRequest("http://localhost/api/storage/nas/download?file=nightly/shop.tar"), params("nas")),
            download.POST(new NextRequest("http://localhost/api/storage/nas/download", { method: "POST", body: JSON.stringify({ file: "nightly/shop.tar" }) }), params("nas")),
            restoreFiles.POST(new NextRequest("http://localhost/api/storage/nas/restore-files", { method: "POST", body: JSON.stringify({ file: "nightly/files.tar", target: { kind: "origin" } }) }), params("nas")),
            restoreFiles.GET(new NextRequest("http://localhost/api/storage/nas/restore-files?token=t"), params("nas")),
            browseDropbox(new NextRequest("http://localhost/api/system/filesystem/dropbox", { method: "POST", body: JSON.stringify({ credentialId: "dropbox-login" }) })),
        ]);

        for (const answer of answers) {
            expect(answer.status).toBe(500);
            const error = await errorOf(answer);
            expect(error.length).toBeGreaterThan(0);
            expect(error).not.toContain("ECONNREFUSED");
            expect(error).not.toContain("secret-path");
        }
    });

    it("still says why a selection to restore was refused, as written for the user", async () => {
        mocks.restoreFilesToStorage.mockRejectedValue(new ValidationError("No files matched the selection", { field: "selections" }));

        const response = await restoreFiles.POST(
            new NextRequest("http://localhost/api/storage/nas/restore-files", { method: "POST", body: JSON.stringify({ file: "nightly/files.tar", target: { kind: "origin" } }) }),
            params("nas")
        );

        expect(response.status).toBe(400);
        expect(await errorOf(response)).toBe("No files matched the selection");
    });
});
