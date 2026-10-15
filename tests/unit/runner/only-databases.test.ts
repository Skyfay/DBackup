/**
 * A run limited to some databases of its job, like a backup a customer starts of one database of a
 * shared server: it is queued with the databases, the steps get them, the dump backs up those
 * alone, and retention judges its backup apart from the whole backups of the job.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    create: vi.fn(),
    updateMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    initialize: vi.fn(),
    calculate: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
    default: {
        execution: { create: mocks.create, updateMany: mocks.updateMany, findUnique: mocks.findUnique, update: mocks.update },
        systemSetting: { findUnique: vi.fn().mockResolvedValue(null) },
    },
}));
vi.mock("@/lib/execution/queue-manager", () => ({ processQueue: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/execution/abort", () => ({ registerExecution: () => new AbortController(), unregisterExecution: vi.fn() }));
vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));
vi.mock("@/lib/runner/steps/01-initialize", () => ({ stepInitialize: mocks.initialize }));
vi.mock("@/lib/runner/steps/02-dump", () => ({ stepExecuteDump: vi.fn() }));
vi.mock("@/lib/runner/steps/03-upload", () => ({ stepUpload: vi.fn() }));
vi.mock("@/lib/runner/steps/04-completion", () => ({ stepCleanup: vi.fn(), stepFinalize: vi.fn() }));
vi.mock("@/services/backup/retention-service", () => ({ RetentionService: { calculateRetention: mocks.calculate } }));
vi.mock("@/services/dashboard-service", () => ({ refreshStorageStatsCache: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/services/storage/storage-service", () => ({
    storageService: { removeStorageListCacheEntry: vi.fn().mockResolvedValue(undefined), readCachedListing: vi.fn().mockResolvedValue(null) },
}));

const { runJob, performExecution, onlyDatabasesOf } = await import("@/lib/runner");
const { limitDatabases } = await import("@/lib/runner/steps/dump-databases");
const { retentionGroup } = await import("@/lib/runner/steps/retention-sidecars");
const { stepRetention } = await import("@/lib/runner/steps/05-retention");
type RunnerContext = import("@/lib/runner/types").RunnerContext;

beforeEach(() => {
    vi.clearAllMocks();
    mocks.create.mockResolvedValue({ id: "run-1" });
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.update.mockResolvedValue({});
    mocks.calculate.mockReturnValue({ keep: [], delete: [], keptForChain: [] });
});

describe("queueing a run of single databases", () => {
    it("keeps the databases in the metadata the run is queued with, the job stays as it is", async () => {
        await runJob("job-1", { type: "Manual", label: "Acme GmbH · Lena Graf" }, { databases: ["shop", "shop"] });
        const data = mocks.create.mock.calls[0][0].data;
        expect(JSON.parse(data.metadata)).toEqual(expect.objectContaining({ onlyDatabases: ["shop"] }));
        expect(data.triggerLabel).toBe("Acme GmbH · Lena Graf");
    });

    it("queues a whole run without the field", async () => {
        await runJob("job-1");
        expect(JSON.parse(mocks.create.mock.calls[0][0].data.metadata)).not.toHaveProperty("onlyDatabases");
    });

    it("reads only a list of names back", () => {
        expect(onlyDatabasesOf({ onlyDatabases: ["a", "", 3, "b"] })).toEqual(["a", "b"]);
        expect(onlyDatabasesOf({ onlyDatabases: [] })).toBeUndefined();
        expect(onlyDatabasesOf({ onlyDatabases: "a" })).toBeUndefined();
    });

    it("hands the databases to the steps and keeps them in the metadata the run ends with", async () => {
        mocks.findUnique.mockResolvedValue({ id: "run-1", jobId: "job-1", logs: "[]", metadata: JSON.stringify({ progress: 0, onlyDatabases: ["shop"] }), job: { id: "job-1" } });
        let seen: RunnerContext | undefined;
        mocks.initialize.mockImplementation(async (ctx: RunnerContext) => {
            seen = ctx;
        });
        await performExecution("run-1", "job-1");
        expect(seen?.onlyDatabases).toEqual(["shop"]);
        expect(seen?.metadata).toEqual(expect.objectContaining({ onlyDatabases: ["shop"] }));
    });
});

describe("the databases a limited run dumps", () => {
    it("dumps the named databases the job backs up, in the order of the job", () => {
        expect(limitDatabases(["blog", "shop", "crm"], ["crm", "shop"], false)).toEqual({ names: ["shop", "crm"], missing: [] });
    });

    it("leaves out a name the job does not back up and reports it", () => {
        expect(limitDatabases(["blog", "shop"], ["shop", "wiki"], false)).toEqual({ names: ["shop"], missing: ["wiki"] });
        expect(limitDatabases(["blog"], ["wiki"], false)).toEqual({ names: [], missing: ["wiki"] });
    });

    it("dumps the named ones by name when the server could not list its databases", () => {
        expect(limitDatabases([], ["shop"], true)).toEqual({ names: ["shop"], missing: [] });
    });
});

describe("retention of backups of single databases", () => {
    it("groups the whole backups together and the others by the databases they hold", () => {
        expect(retentionGroup(undefined)).toBe("");
        expect(retentionGroup([])).toBe("");
        expect(retentionGroup(["shop", "blog"])).toBe(retentionGroup(["blog", "shop"]));
        expect(retentionGroup(["shop"])).not.toBe(retentionGroup(["blog"]));
    });

    /** A destination with two whole backups and a backup of shop alone, each with its sidecar. */
    function destination() {
        const meta: Record<string, object> = {
            "/Job/a.tar.meta.json": { jobId: "job-1", timestamp: "2026-10-01T03:00:00.000Z" },
            "/Job/b.tar.meta.json": { jobId: "job-1", timestamp: "2026-10-02T03:00:00.000Z" },
            "/Job/shop.tar.meta.json": { jobId: "job-1", timestamp: "2026-10-02T14:00:00.000Z", onlyDatabases: ["shop"] },
        };
        const file = (name: string) => ({ name, path: `/Job/${name}`, size: 1, lastModified: new Date("2026-10-02T15:00:00.000Z") });
        return {
            configId: "nas",
            configName: "NAS",
            adapterId: "local-filesystem",
            config: {},
            retention: { mode: "SIMPLE", simple: { keepCount: 1 } },
            priority: 0,
            uploadResult: { success: true, path: "/Job/shop.tar" },
            adapter: {
                list: vi.fn().mockResolvedValue([file("a.tar"), file("b.tar"), file("shop.tar"), ...Object.keys(meta).map((path) => file(path.slice(5)))]),
                read: vi.fn(async (_config: unknown, path: string) => (meta[path] ? JSON.stringify(meta[path]) : null)),
                delete: vi.fn(),
            },
        };
    }

    const ctxOf = (onlyDatabases?: string[]) => ({
        jobId: "job-1",
        job: { id: "job-1", name: "Job" },
        logs: [],
        log: vi.fn(),
        destinations: [destination()],
        onlyDatabases,
    }) as unknown as RunnerContext;

    const judged = () => (mocks.calculate.mock.calls[0][0] as { name: string }[]).map((file) => file.name).sort();

    it("judges a whole run's backups without the backups of single databases", async () => {
        await stepRetention(ctxOf());
        expect(judged()).toEqual(["a.tar", "b.tar"]);
    });

    it("judges a run of shop alone with the other backups of shop alone, never a whole backup", async () => {
        await stepRetention(ctxOf(["shop"]));
        expect(judged()).toEqual(["shop.tar"]);
    });
});
