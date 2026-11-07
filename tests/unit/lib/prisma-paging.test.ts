// @vitest-environment node
/**
 * A read of more than 999 parents that orders one of their relations, against a real SQLite
 * database migrated with the migrations of this version. Prisma 6 panics on it in one statement,
 * so `relationOrderPaging` reads it in pages.
 */
import { execFileSync } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

const { openCopy } = await import("@/services/config/database-copy");
const { ordersRelations, pagedByParents, relationOrderPaging, RELATION_ORDER_PAGE } = await import("@/lib/prisma-paging");

const JOBS = 1200;

let root = "";
let plain: ReturnType<typeof openCopy>;

beforeAll(async () => {
    root = mkdtempSync(path.join(os.tmpdir(), "dbackup-relation-paging-"));
    const file = path.join(root, "paging.db");
    execFileSync(path.join(process.cwd(), "node_modules", ".bin", "prisma"), ["migrate", "deploy"], {
        env: { ...process.env, DATABASE_URL: `file:${file}` },
        stdio: "pipe",
    });
    plain = openCopy(file);
    await plain.adapterConfig.createMany({
        data: [
            { id: "src", name: "Shop", type: "database", adapterId: "mysql", config: "{}" },
            { id: "near", name: "Near", type: "storage", adapterId: "local-filesystem", config: "{}" },
            { id: "far", name: "Far", type: "storage", adapterId: "local-filesystem", config: "{}" },
        ],
    });
    const ids = Array.from({ length: JOBS }, (_, index) => `job-${String(index).padStart(4, "0")}`);
    await plain.job.createMany({ data: ids.map((id) => ({ id, name: id, schedule: "0 3 * * *", sourceId: "src" })) });
    // Far is written first with the higher priority, so an unordered read would name it first.
    await plain.jobDestination.createMany({
        data: ids.flatMap((jobId) => [
            { jobId, configId: "far", priority: 1 },
            { jobId, configId: "near", priority: 0 },
        ]),
    });
}, 120_000);

afterAll(async () => {
    await plain?.$disconnect();
    if (root) rmSync(root, { recursive: true, force: true });
});

const ordered = {
    select: { id: true, destinations: { select: { configId: true }, orderBy: { priority: "asc" as const } } },
    orderBy: { name: "desc" as const },
};

describe("a read of more than 999 jobs with their ordered destinations", () => {
    it("breaks Prisma in one statement, which is why the paging exists (when this passes, Prisma fixed it)", async () => {
        await expect(plain.job.findMany(ordered)).rejects.toThrow();
    });

    it("reads every job in the order asked, each with its destinations in their order", async () => {
        const paged = plain.$extends(relationOrderPaging);

        const jobs = await paged.job.findMany(ordered);

        expect(jobs).toHaveLength(JOBS);
        expect(jobs[0].id).toBe("job-1199");
        expect(jobs.at(-1)?.id).toBe("job-0000");
        expect(new Set(jobs.map((job) => job.id)).size).toBe(JOBS);
        expect(jobs.every((job) => job.destinations.map((entry) => entry.configId).join() === "near,far")).toBe(true);
    });

    it("keeps a skip and a take of the read", async () => {
        const paged = plain.$extends(relationOrderPaging);

        const jobs = await paged.job.findMany({ ...ordered, skip: 100, take: 1050 });

        expect(jobs).toHaveLength(1050);
        expect(jobs[0].id).toBe("job-1099");
        expect(jobs.at(-1)?.id).toBe("job-0050");
    });
});

describe("the pages of a read", () => {
    const run = vi.fn(async (args: Record<string, unknown>) => {
        const skip = (args.skip as number | undefined) ?? 0;
        const take = (args.take as number | undefined) ?? 5000;
        return Array.from({ length: Math.max(0, Math.min(take, 2500 - skip)) }, (_, index) => skip + index);
    });

    it("run one statement while no relation is ordered, or a small take, a cursor or distinct asks for it", async () => {
        for (const args of [
            { select: { id: true, destinations: { select: { configId: true } } } },
            { take: RELATION_ORDER_PAGE, select: { destinations: { orderBy: { priority: "asc" } } } },
            { cursor: { id: "x" }, include: { destinations: { orderBy: { priority: "asc" } } } },
            { distinct: ["name"], include: { destinations: { orderBy: { priority: "asc" } } } },
        ]) {
            run.mockClear();
            await pagedByParents(args, run);
            expect(run).toHaveBeenCalledTimes(1);
            expect(run).toHaveBeenCalledWith(args);
        }
    });

    it("finds an ordered relation at any depth", () => {
        expect(ordersRelations({ select: { destinations: { select: { config: { select: { healthLogs: { orderBy: { createdAt: "desc" } } } } } } } })).toBe(true);
        expect(ordersRelations({ select: { _count: { select: { executions: true } } } })).toBe(false);
    });

    it("read in pages of 999 with the id last until a page comes back short", async () => {
        run.mockClear();
        const rows = await pagedByParents({ orderBy: [{ name: "asc" }], include: { destinations: { orderBy: { priority: "asc" } } } }, run);

        expect(rows).toHaveLength(2500);
        expect(run.mock.calls.map(([args]) => [args.skip, args.take])).toEqual([[0, 999], [999, 999], [1998, 999]]);
        expect(run.mock.calls[0][0].orderBy).toEqual([{ name: "asc" }, { id: "asc" }]);
    });
});
