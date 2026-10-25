import { beforeEach, describe, expect, it, vi } from "vitest";
import { Readable } from "stream";
import { NextRequest } from "next/server";
import { PermissionError } from "@/lib/logging/errors";

const mocks = vi.hoisted(() => ({
    permissions: [] as string[],
    userId: "u1",
    isPlatformAdmin: false,
    apiKeyId: undefined as string | undefined,
    makerMayDownload: vi.fn(),
    isConfigBackupFile: vi.fn(),
    planArchiveDownload: vi.fn(),
    openArchiveDownload: vi.fn(),
    auditLog: vi.fn(),
    auditLogFor: vi.fn(),
    findDestination: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/adapters", () => ({ registerAdapters: vi.fn() }));
vi.mock("@/lib/auth/access-control", () => ({
    getAuthContext: async () => ({
        userId: mocks.userId, permissions: mocks.permissions, isPlatformAdmin: mocks.isPlatformAdmin, tenantId: "acme",
        authMethod: mocks.apiKeyId ? "apikey" : "session", ...(mocks.apiKeyId ? { apiKeyId: mocks.apiKeyId } : {}),
    }),
    tenantOf: (ctx: { tenantId: string }) => ctx.tenantId,
    checkPermissionWithContext: (_ctx: unknown, permission: string) => {
        if (!mocks.permissions.includes(permission)) throw new PermissionError(permission);
    },
}));
vi.mock("@/services/audit-service", () => ({ auditService: { log: mocks.auditLog, logFor: mocks.auditLogFor } }));
vi.mock("@/services/storage/backup-audit", () => ({
    backupAuditDetails: async (_destinationId: string, file: string) => ({ file, destination: "NAS", job: "Shop" }),
}));
vi.mock("@/services/storage/storage-service", () => ({ storageService: { downloadFile: vi.fn() } }));
vi.mock("@/services/restore/archive-download", () => ({ planArchiveDownload: mocks.planArchiveDownload, openArchiveDownload: mocks.openArchiveDownload }));
vi.mock("@/services/sharing/destination-access", async () => {
    const { innerPath } = await import("@/lib/tenant/storage-view");
    return {
        findDestination: (...args: unknown[]) => mocks.findDestination(...args),
        // The path through the view the destination has, as the real one does.
        findDestinationPath: async (id: string, remotePath: string, tenantId?: string) => {
            const found = await mocks.findDestination(id, tenantId);
            innerPath(found.mode, remotePath);
            return found;
        },
    };
});
// Whether the maker of a link may still download, which the database decides.
vi.mock("@/lib/auth/download-maker", () => ({ makerMayDownload: (...args: unknown[]) => mocks.makerMayDownload(...args) }));
vi.mock("@/services/storage/config-backup-access", () => ({ isConfigBackupFile: (...args: unknown[]) => mocks.isConfigBackupFile(...args) }));

const { POST, GET } = await import("@/app/api/storage/[id]/download-url/route");
const { GET: FETCH } = await import("@/app/api/storage/public-download/route");

const makeLink = (body: unknown) => POST(
    new NextRequest("http://dbackup.test/api/storage/nas/download-url", { method: "POST", body: JSON.stringify(body), headers: { origin: "http://dbackup.test" } }),
    { params: Promise.resolve({ id: "nas" }) }
);
const statusOf = (token: string) => GET(new NextRequest(`http://dbackup.test/api/storage/nas/download-url?token=${token}`), { params: Promise.resolve({ id: "nas" }) });
const fetchLink = (url: string) => FETCH(new NextRequest(url, { headers: { "x-dbackup-client-address": "10.0.0.5", "user-agent": "curl/8.7.1" } }));

describe("download links for a pick", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.permissions = ["storage:download"];
        mocks.userId = "u1";
        mocks.isPlatformAdmin = false;
        mocks.apiKeyId = undefined;
        mocks.makerMayDownload.mockResolvedValue(true);
        mocks.isConfigBackupFile.mockResolvedValue(false);
        mocks.findDestination.mockResolvedValue({ row: { id: "nas", name: "NAS" }, mode: { kind: "own" }, tenantId: "acme" });
        mocks.planArchiveDownload.mockResolvedValue({ fileName: "Shop_2026-09-24_2-items.tar.gz", contentType: "application/gzip" });
        mocks.openArchiveDownload.mockImplementation(async () => ({
            stream: Readable.from([Buffer.from("tar "), Buffer.from("bytes")]),
            fileName: "Shop_2026-09-24_2-items.tar.gz",
            contentType: "application/gzip",
        }));
    });

    it("opens the archive before it hands out a link, so a missing key or an empty pick shows in the dialog", async () => {
        const response = await makeLink({ file: "Shop/backup.tar", databases: ["billing"], selections: [{ src: "src-1" }] });
        const { data } = await response.json();

        expect(response.status).toBe(200);
        expect(mocks.planArchiveDownload).toHaveBeenCalledWith(expect.objectContaining({ file: "Shop/backup.tar", databases: ["billing"], selections: [{ src: "src-1" }] }));
        expect(data).toMatchObject({ fileName: "Shop_2026-09-24_2-items.tar.gz", token: expect.any(String) });
        expect(data.url).toBe(`http://dbackup.test/api/storage/public-download?token=${data.token}`);
    });

    it("streams the pick to the command and counts the link as fetched only after the last byte", async () => {
        const { data } = await (await makeLink({ file: "Shop/backup.tar", databases: ["billing"] })).json();

        const response = await fetchLink(data.url);
        expect(response.headers.get("content-disposition")).toContain("Shop_2026-09-24_2-items.tar.gz");
        expect((await (await statusOf(data.token)).json()).data.state).toBe("open");

        expect(await response.text()).toBe("tar bytes");
        const status = (await (await statusOf(data.token)).json()).data;
        expect(status).toMatchObject({ state: "fetched", fetchedFrom: "10.0.0.5" });
        expect((await fetchLink(data.url)).status).toBe(401);
    });

    it("notes the link as made by its maker, and its download as fetched from the host that ran the command, as the origin of the entry", async () => {
        const { data } = await (await makeLink({ file: "Shop/backup.tar", databases: ["billing"] })).json();

        expect(mocks.auditLogFor).toHaveBeenCalledWith(
            expect.objectContaining({ userId: "u1" }),
            "EXPORT",
            "BACKUP",
            { action: "download_link_created", file: "Shop/backup.tar", destination: "NAS", job: "Shop", databases: ["billing"] },
            "nas"
        );

        await (await fetchLink(data.url)).text();

        await vi.waitFor(() => expect(mocks.auditLog).toHaveBeenCalledWith(
            "u1",
            "EXPORT",
            "BACKUP",
            expect.objectContaining({ action: "download_link", file: "Shop/backup.tar", destination: "NAS", databases: ["billing"] }),
            "nas",
            { ipAddress: "10.0.0.5", userAgent: "curl/8.7.1", tenantId: "acme" }
        ));
        // The address stays where `originShown` hides it from the log of a customer, never in the details.
        expect(mocks.auditLog.mock.calls[0][3]).not.toHaveProperty("from");
    });

    it("makes no link and notes none for a destination the tenant does not use", async () => {
        const { NotFoundError } = await import("@/lib/logging/errors");
        mocks.findDestination.mockRejectedValue(new NotFoundError("Storage adapter", "nas"));

        const response = await makeLink({ file: "Shop/backup.tar" });

        expect(response.status).toBe(404);
        expect(mocks.findDestination).toHaveBeenCalledWith("nas", "acme");
        expect(mocks.auditLogFor).not.toHaveBeenCalled();
    });

    it("makes no link and notes none for a file in the folder of the customers of a destination its tenant shares", async () => {
        mocks.findDestination.mockResolvedValue({ row: { id: "nas", name: "NAS" }, mode: { kind: "provider" }, tenantId: "acme" });

        const response = await makeLink({ file: "tenants/globex/Shop/backup.tar" });

        expect(response.status).toBe(400);
        expect(mocks.planArchiveDownload).not.toHaveBeenCalled();
        expect(mocks.auditLogFor).not.toHaveBeenCalled();
    });

    it("serves a link in the tenant it was made in, since the command has no session", async () => {
        const { explicitScope } = await import("@/lib/tenant/context");
        let servedIn: unknown;
        mocks.openArchiveDownload.mockImplementationOnce(async () => {
            servedIn = explicitScope();
            throw new Error("stop after the scope was seen");
        });
        const { data } = await (await makeLink({ file: "Shop/backup.tar", databases: ["billing"] })).json();
        await fetchLink(data.url);

        expect(servedIn).toEqual({ kind: "tenant", tenantId: "acme" });
    });

    it("serves no token another download hands to its own session, which is no link", async () => {
        const { generateDownloadToken, generateFileDownloadToken, generateSelectionDownloadToken } = await import("@/lib/auth/download-tokens");
        const { storageService } = await import("@/services/storage/storage-service");
        const tokens = [
            generateSelectionDownloadToken({ storageId: "nas", file: "Shop/backup.tar", userId: "u1", fileName: "pick.tar.gz", databases: ["billing"] }),
            generateFileDownloadToken({ storageId: "nas", file: "Shop/backup.tar", userId: "u1", tempFile: "/nonexistent/dbackup-test/never-written", fileName: "billing.sql", contentType: "application/sql" }),
            generateDownloadToken("nas", "Shop/backup.tar"),
        ];

        for (const token of tokens) {
            expect((await fetchLink(`http://dbackup.test/api/storage/public-download?token=${token}`)).status).toBe(401);
        }
        expect(storageService.downloadFile).not.toHaveBeenCalled();
        expect(mocks.openArchiveDownload).not.toHaveBeenCalled();
    });

    it("lets the command run again after a transfer that broke off", async () => {
        mocks.openArchiveDownload.mockImplementationOnce(async () => {
            const stream = new Readable({ read() { this.destroy(new Error("connection reset")); } });
            return { stream, fileName: "billing.dump", contentType: "application/octet-stream" };
        });
        const { data } = await (await makeLink({ file: "Shop/backup.tar", databases: ["billing"] })).json();

        await (await fetchLink(data.url)).text().catch(() => null);

        expect((await (await statusOf(data.token)).json()).data.state).toBe("open");
        expect(await (await fetchLink(data.url)).text()).toBe("tar bytes");
    });

    it("tells nobody but its maker whether a link was fetched", async () => {
        const { data } = await (await makeLink({ file: "Shop/backup.tar", databases: ["billing"] })).json();

        mocks.userId = "u2";
        const status = await (await statusOf(data.token)).json();

        expect(status).toEqual({ success: true, data: { state: "expired" } });
    });

    it("serves no link once its maker may no longer download in its tenant", async () => {
        const { data } = await (await makeLink({ file: "Shop/backup.tar", databases: ["billing"] })).json();
        mocks.makerMayDownload.mockResolvedValue(false);

        const response = await fetchLink(data.url);

        expect(response.status).toBe(403);
        expect(mocks.makerMayDownload).toHaveBeenCalledWith({ userId: "u1", tenantId: "acme" });
        expect(mocks.openArchiveDownload).not.toHaveBeenCalled();
    });

    it("asks again for the API key a link was made with, not only for its owner", async () => {
        mocks.apiKeyId = "key-ci";
        const { data } = await (await makeLink({ file: "Shop/backup.tar", databases: ["billing"] })).json();

        await (await fetchLink(data.url)).text();

        expect(mocks.makerMayDownload).toHaveBeenCalledWith({ userId: "u1", tenantId: "acme", apiKeyId: "key-ci" });
    });

    it("makes no link to a configuration backup, not even for a platform admin, and notes none", async () => {
        mocks.isPlatformAdmin = true;
        mocks.isConfigBackupFile.mockResolvedValue(true);

        const response = await makeLink({ file: "config-backups/config_backup_2026-10-18.db.gz.enc", decrypt: true });

        expect(response.status).toBe(403);
        expect(mocks.isConfigBackupFile).toHaveBeenCalledWith("nas", "config-backups/config_backup_2026-10-18.db.gz.enc", "acme");
        expect(mocks.auditLogFor).not.toHaveBeenCalled();
    });

    it("serves no configuration backup through a link, whatever the link names", async () => {
        const { storageService } = await import("@/services/storage/storage-service");
        const { data } = await (await makeLink({ file: "nightly/renamed.db.gz.enc", decrypt: true })).json();
        // The sidecar says it is one, which the link never knew.
        mocks.isConfigBackupFile.mockResolvedValue(true);

        const response = await fetchLink(data.url);

        expect(response.status).toBe(403);
        expect(storageService.downloadFile).not.toHaveBeenCalled();
    });

    it("hands out no link without the download permission", async () => {
        mocks.permissions = ["storage:restore"];

        const response = await makeLink({ file: "Shop/backup.tar", databases: ["billing"] });

        expect(response.status).toBe(403);
        expect(mocks.planArchiveDownload).not.toHaveBeenCalled();
    });
});
