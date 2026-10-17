/**
 * The download of a shared database's dump hands the customer an address with the token alone,
 * never the destination of the server's tenant. The token holds once, for the user and the tenant
 * that asked for it, and no other download serves it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { NextRequest } from "next/server";
import { PermissionError } from "@/lib/logging/errors";

const mocks = vi.hoisted(() => ({
    ctx: { userId: "u-ana", tenantId: "acme" as string | null, permissions: ["storage:download"] as string[] },
    prepare: vi.fn(),
    audit: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth/access-control", () => ({
    getAuthContext: async () => mocks.ctx,
    checkPermissionWithContext: (ctx: { permissions: string[] }, permission: string) => {
        if (!ctx.permissions.includes(permission)) throw new PermissionError(permission);
    },
    checkPermission: async (permission: string) => {
        if (!mocks.ctx.permissions.includes(permission)) throw new PermissionError(permission);
        return { id: mocks.ctx.userId, name: "Ana", tenantId: mocks.ctx.tenantId };
    },
}));
vi.mock("@/lib/logging/logger", () => ({ logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) } }));
vi.mock("@/services/audit-service", () => ({ auditService: { log: mocks.audit } }));
vi.mock("@/services/tenant/shared-databases", () => ({ prepareSharedDownload: mocks.prepare, restoreSharedBackup: vi.fn(), sharedOverview: vi.fn() }));
vi.mock("@/services/tenant/shared-on-demand", () => ({ requestSharedBackup: vi.fn(), sharedBackupRun: vi.fn() }));

const { generateSharedDownloadToken, consumeFileDownloadToken, claimLinkToken } = await import("@/lib/auth/download-tokens");
const { GET } = await import("@/app/api/shared/download/route");
const { downloadSharedBackup } = await import("@/app/actions/tenant/shared-databases");

const REF = { sourceId: "shared-mysql", databaseName: "shop_acme", backupId: "a".repeat(32) };

/** A dump pulled out of a backup of the MSP, parked for Ana of Acme. */
function parked(content = "-- dump of shop_acme") {
    const tempFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "shared-download-")), "dump");
    fs.writeFileSync(tempFile, content);
    const token = generateSharedDownloadToken({
        storageId: "msp-nas", file: "nightly/2026-10-15_0214_nightly.tar", tenantId: "acme", userId: "u-ana",
        tempFile, fileName: "2026-10-15_0214_shop_acme.sql", contentType: "application/octet-stream",
    });
    return { token, tempFile };
}

const fetchDump = (token: string) => GET(new NextRequest(`http://dbackup.test/api/shared/download?token=${token}`));

beforeEach(() => {
    vi.clearAllMocks();
    mocks.ctx = { userId: "u-ana", tenantId: "acme", permissions: ["storage:download"] };
});

describe("the download of a shared database's dump", () => {
    it("hands out an address with the token alone, never the destination of the server", async () => {
        mocks.prepare.mockResolvedValue({ token: "t0k3n", fileName: "2026-10-15_0214_shop_acme.sql" });
        const result = await downloadSharedBackup(REF);
        expect(result).toEqual({ success: true, data: { url: "/api/shared/download?token=t0k3n", fileName: "2026-10-15_0214_shop_acme.sql" } });
    });

    it("sends the dump once to the user who asked for it and removes it afterwards", async () => {
        const { token, tempFile } = parked();
        const response = await fetchDump(token);
        expect(response.status).toBe(200);
        expect(response.headers.get("content-disposition")).toContain("2026-10-15_0214_shop_acme.sql");
        expect(await response.text()).toBe("-- dump of shop_acme");
        await vi.waitFor(() => expect(fs.existsSync(tempFile)).toBe(false));
        expect((await fetchDump(token)).status).toBe(410);
    });

    it("sends nothing to another user or in another tenant", async () => {
        const { token } = parked();
        mocks.ctx = { ...mocks.ctx, userId: "u-gil" };
        expect((await fetchDump(token)).status).toBe(410);
        mocks.ctx = { userId: "u-ana", tenantId: "globex", permissions: ["storage:download"] };
        expect((await fetchDump(token)).status).toBe(410);
        mocks.ctx = { userId: "u-ana", tenantId: "acme", permissions: ["storage:download"] };
        expect((await fetchDump(token)).status).toBe(200);
    });

    it("sends nothing without the right to download", async () => {
        const { token } = parked();
        mocks.ctx = { ...mocks.ctx, permissions: [] };
        expect((await fetchDump(token)).status).toBe(403);
    });

    it("is never served by the download of a destination or as a link", () => {
        const { token } = parked();
        expect(consumeFileDownloadToken(token, "u-ana")).toBeNull();
        expect(claimLinkToken(token)).toBeNull();
    });
});
