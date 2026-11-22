import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A restore writes back into the folder a directory source read without the right to change that
 * connection. Which source an archive holds is said by its index at the destination and by the
 * request, so it counts only when a backup run of the job of that source recorded the file at the
 * destination. An archive someone laid there never does.
 */

interface Run { jobId: string; path: string; type: string; metadata: string | null }

const db = vi.hoisted(() => ({
    sources: new Map<string, { jobId: string }>(),
    runs: [] as Run[],
}));

vi.mock("@/lib/prisma", () => ({
    default: {
        jobSource: { findUnique: async ({ where }: { where: { id: string } }) => db.sources.get(where.id) ?? null },
        execution: {
            findMany: async ({ where }: { where: { type: string; jobId: string; path: { in: string[] } } }) =>
                db.runs.filter((run) => run.type === where.type && run.jobId === where.jobId && where.path.in.includes(run.path)),
        },
    },
}));

const sidecar = vi.hoisted(() => ({ bytes: null as Buffer | null }));
vi.mock("@/services/backup/archive-index-service", () => ({ archiveIndexService: { fetchSidecar: async () => sidecar.bytes } }));

const { createHash } = await import("crypto");
const { archiveReadSource } = await import("@/services/restore/recorded-origin");

const INDEX = Buffer.from("the index the run wrote");
const DIGEST = createHash("sha256").update(INDEX).digest("hex");
const wrote = (configId: string, path: string, status = "success", indexSha256: string | null = DIGEST) =>
    JSON.stringify({ destinations: [{ configId, path, status }], ...(indexSha256 ? { indexSha256 } : {}) });
const MEMBER = { trustsUnhashed: false };
const ADMIN = { trustsUnhashed: true };

beforeEach(() => {
    sidecar.bytes = INDEX;
    db.sources.clear();
    db.runs = [];
    db.sources.set("src-www", { jobId: "job-shop" });
});

describe("whether a backup holds the files of a directory source", () => {
    it("is yes for a backup a run of the job of the source wrote to this destination", async () => {
        db.runs.push({ jobId: "job-shop", path: "Shop/Shop_1.tar", type: "Backup", metadata: wrote("dest-1", "Shop/Shop_1.tar") });
        expect(await archiveReadSource("dest-1", "Shop/Shop_1.tar", "src-www", MEMBER)).toBe(true);
        // The path as a request may write it.
        expect(await archiveReadSource("dest-1", "/Shop/Shop_1.tar", "src-www", MEMBER)).toBe(true);
    });

    it("is no for an archive laid at the destination that no run wrote", async () => {
        expect(await archiveReadSource("dest-1", "laid/b.tar", "src-www", MEMBER)).toBe(false);
    });

    it("is no for a backup of another job, whose index names the source all the same", async () => {
        db.runs.push({ jobId: "job-other", path: "Other/Other_1.tar", type: "Backup", metadata: wrote("dest-1", "Other/Other_1.tar") });
        expect(await archiveReadSource("dest-1", "Other/Other_1.tar", "src-www", MEMBER)).toBe(false);
    });

    it("is no at a destination the run did not reach, and for a path of the same name elsewhere", async () => {
        db.runs.push({ jobId: "job-shop", path: "Shop/Shop_1.tar", type: "Backup", metadata: wrote("dest-1", "Shop/Shop_1.tar") });
        db.runs.push({ jobId: "job-shop", path: "Shop/Shop_2.tar", type: "Backup", metadata: wrote("dest-2", "Shop/Shop_2.tar", "failed") });
        expect(await archiveReadSource("dest-2", "Shop/Shop_1.tar", "src-www", MEMBER)).toBe(false);
        expect(await archiveReadSource("dest-2", "Shop/Shop_2.tar", "src-www", MEMBER)).toBe(false);
    });

    it("is no for a source that is gone, a run without a record and a restore run of the same path", async () => {
        db.runs.push({ jobId: "job-shop", path: "Shop/Shop_1.tar", type: "Backup", metadata: null });
        db.runs.push({ jobId: "job-shop", path: "Shop/Shop_1.tar", type: "Backup", metadata: "{not json" });
        db.runs.push({ jobId: "job-shop", path: "Shop/Shop_3.tar", type: "Restore", metadata: wrote("dest-1", "Shop/Shop_3.tar") });
        expect(await archiveReadSource("dest-1", "Shop/Shop_1.tar", "src-www", MEMBER)).toBe(false);
        expect(await archiveReadSource("dest-1", "Shop/Shop_3.tar", "src-www", MEMBER)).toBe(false);
        expect(await archiveReadSource("dest-1", "Shop/Shop_1.tar", "src-gone", MEMBER)).toBe(false);
        expect(await archiveReadSource("dest-1", "", "src-www", MEMBER)).toBe(false);
    });
});

describe("a backup at the recorded path whose bytes another hand laid there", () => {
    it("is no when the index the restore reads is not the one the run wrote", async () => {
        db.runs.push({ jobId: "job-shop", path: "Shop/Shop_1.tar", type: "Backup", metadata: wrote("dest-1", "Shop/Shop_1.tar") });

        expect(await archiveReadSource("dest-1", "Shop/Shop_1.tar", "src-www", { ...MEMBER, indexSha256: "f".repeat(64) })).toBe(false);
        sidecar.bytes = Buffer.from("a forged index");
        expect(await archiveReadSource("dest-1", "Shop/Shop_1.tar", "src-www", MEMBER)).toBe(false);
        sidecar.bytes = null;
        expect(await archiveReadSource("dest-1", "Shop/Shop_1.tar", "src-www", MEMBER)).toBe(false);
    });

    it("is yes when the restore parses the index the run wrote", async () => {
        db.runs.push({ jobId: "job-shop", path: "Shop/Shop_1.tar", type: "Backup", metadata: wrote("dest-1", "Shop/Shop_1.tar") });
        sidecar.bytes = null;

        expect(await archiveReadSource("dest-1", "Shop/Shop_1.tar", "src-www", { ...MEMBER, indexSha256: DIGEST })).toBe(true);
    });

    it("counts a run of a version that recorded no digest for a platform admin with a session alone", async () => {
        db.runs.push({ jobId: "job-shop", path: "Shop/Shop_1.tar", type: "Backup", metadata: wrote("dest-1", "Shop/Shop_1.tar", "success", null) });

        expect(await archiveReadSource("dest-1", "Shop/Shop_1.tar", "src-www", MEMBER)).toBe(false);
        expect(await archiveReadSource("dest-1", "Shop/Shop_1.tar", "src-www", ADMIN)).toBe(true);
    });
});
