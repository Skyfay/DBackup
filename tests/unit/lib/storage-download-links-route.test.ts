import { beforeEach, describe, expect, it, vi } from "vitest";
import { Readable } from "stream";
import { NextRequest } from "next/server";
import { PermissionError } from "@/lib/logging/errors";

const mocks = vi.hoisted(() => ({
    permissions: [] as string[],
    userId: "u1",
    planArchiveDownload: vi.fn(),
    openArchiveDownload: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/adapters", () => ({ registerAdapters: vi.fn() }));
vi.mock("@/lib/auth/access-control", () => ({
    getAuthContext: async () => ({ userId: mocks.userId, permissions: mocks.permissions, isSuperAdmin: false }),
    checkPermissionWithContext: (_ctx: unknown, permission: string) => {
        if (!mocks.permissions.includes(permission)) throw new PermissionError(permission);
    },
}));
vi.mock("@/services/audit-service", () => ({ auditService: { log: vi.fn() } }));
vi.mock("@/services/storage/storage-service", () => ({ storageService: { downloadFile: vi.fn() } }));
vi.mock("@/services/restore/archive-download", () => ({ planArchiveDownload: mocks.planArchiveDownload, openArchiveDownload: mocks.openArchiveDownload }));

const { POST, GET } = await import("@/app/api/storage/[id]/download-url/route");
const { GET: FETCH } = await import("@/app/api/storage/public-download/route");

const makeLink = (body: unknown) => POST(
    new NextRequest("http://dbackup.test/api/storage/nas/download-url", { method: "POST", body: JSON.stringify(body), headers: { origin: "http://dbackup.test" } }),
    { params: Promise.resolve({ id: "nas" }) }
);
const statusOf = (token: string) => GET(new NextRequest(`http://dbackup.test/api/storage/nas/download-url?token=${token}`), { params: Promise.resolve({ id: "nas" }) });
const fetchLink = (url: string) => FETCH(new NextRequest(url, { headers: { "x-forwarded-for": "10.0.0.5, 172.17.0.1" } }));

describe("download links for a pick", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.permissions = ["storage:download"];
        mocks.userId = "u1";
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

    it("hands out no link without the download permission", async () => {
        mocks.permissions = ["storage:restore"];

        const response = await makeLink({ file: "Shop/backup.tar", databases: ["billing"] });

        expect(response.status).toBe(403);
        expect(mocks.planArchiveDownload).not.toHaveBeenCalled();
    });
});
