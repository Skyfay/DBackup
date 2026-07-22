import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ArchiveIndex } from "@/lib/archive/types";

const prismaMock = {
    execution: { findFirst: vi.fn() },
    adapterConfig: { findUnique: vi.fn() },
};
vi.mock("@/lib/prisma", () => ({ default: prismaMock }));

const registryGet = vi.fn();
vi.mock("@/lib/core/registry", () => ({ registry: { get: (...a: unknown[]) => registryGet(...a) } }));
vi.mock("@/lib/adapters/config-resolver", () => ({ resolveAdapterConfig: async (c: unknown) => c }));

const loadIndex = vi.fn();
vi.mock("@/services/backup/archive-index-service", () => ({
    archiveIndexService: { load: (...a: unknown[]) => loadIndex(...a) },
}));
vi.mock("@/lib/logging/logger", () => ({
    logger: { child: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }) },
}));

const { planChain } = await import("@/services/backup/chain-planner");

const NOW = new Date("2026-07-22T03:00:00.000Z");
const CHAIN_DIR = "chain-2026-07-20T03-00-00-000";
const PREV_PATH = `plex/${CHAIN_DIR}/inc-yesterday.tar`;

/** Previous snapshot: two days into a chain, at position 1. */
function previousExecution(overrides: Record<string, unknown> = {}) {
    return {
        id: "exec-prev", chainId: "chain-1", chainIndex: 1, path: PREV_PATH,
        startedAt: new Date("2026-07-21T03:00:00.000Z"), ...overrides,
    };
}

function previousIndex(excludePatterns: string[] = ["*.log"], sources = ["src-1"]): ArchiveIndex {
    return {
        header: { k: "h", v: 2, createdAt: "2026-07-21T03:00:00.000Z", archive: "inc-yesterday.tar" },
        entries: new Map(),
        databases: [],
        directories: sources.map((src) => ({
            k: "d" as const, src, label: "Plex", fileCount: 1, totalSize: 1, excludePatterns,
        })),
        files: [],
        deps: [],
    };
}

const META = JSON.stringify({
    version: 1,
    archive: { formatVersion: 2, indexFile: ".index", encrypted: true, profileId: "profile-1" },
});

function input(overrides: Record<string, unknown> = {}) {
    return {
        job: {
            id: "job-1", name: "plex", backupMode: "INCREMENTAL",
            fullEveryDays: 7, encryptionProfileId: "profile-1",
        },
        sources: [{ jobSourceId: "src-1", excludePatterns: ["*.log"] }],
        destinationConfigIds: ["dest-1"],
        now: NOW,
        ...overrides,
    } as Parameters<typeof planChain>[0];
}

/** Healthy default: previous snapshot readable, chain intact at the destination. */
function happyPath() {
    prismaMock.execution.findFirst.mockImplementation(async (args: { where: { chainIndex?: number } }) =>
        args.where.chainIndex === 0
            ? { ...previousExecution(), chainIndex: 0, startedAt: new Date("2026-07-20T03:00:00.000Z") }
            : previousExecution()
    );
    prismaMock.adapterConfig.findUnique.mockResolvedValue({ id: "dest-1", type: "storage", adapterId: "local", config: "{}" });
    registryGet.mockReturnValue({
        read: vi.fn().mockResolvedValue(META),
        // Two archives present, matching a chain that is two deep.
        list: vi.fn().mockResolvedValue([
            { name: "full-a.tar", path: `plex/${CHAIN_DIR}/full-a.tar`, size: 1, lastModified: NOW },
            { name: "inc-yesterday.tar", path: PREV_PATH, size: 1, lastModified: NOW },
        ]),
    });
    loadIndex.mockResolvedValue(previousIndex());
}

beforeEach(() => {
    vi.clearAllMocks();
    happyPath();
});

describe("planChain", () => {
    it("continues the chain when nothing changed", async () => {
        const plan = await planChain(input());

        expect(plan.type).toBe("incremental");
        expect(plan.chainId).toBe("chain-1");
        expect(plan.index).toBe(2);
        expect(plan.baseArchive).toBe("inc-yesterday.tar");
        expect(plan.chainDir).toBe(CHAIN_DIR);
        expect(plan.previousIndex).toBeDefined();
    });

    describe("degrades to a full backup when", () => {
        it("the job is not in incremental mode", async () => {
            const plan = await planChain(input({ job: { ...input().job, backupMode: "FULL" } }));
            expect(plan.type).toBe("full");
            expect(plan.index).toBe(0);
        });

        it("there is no previous backup", async () => {
            prismaMock.execution.findFirst.mockResolvedValue(null);
            const plan = await planChain(input());
            expect(plan).toMatchObject({ type: "full", reason: expect.stringMatching(/no previous backup/i) });
        });

        it("the chain reached its maximum age", async () => {
            const plan = await planChain(input({ job: { ...input().job, fullEveryDays: 1 } }));
            expect(plan).toMatchObject({ type: "full", reason: expect.stringMatching(/maximum age/i) });
        });

        it("the previous metadata cannot be read", async () => {
            registryGet.mockReturnValue({ read: vi.fn().mockResolvedValue(null), list: vi.fn() });
            const plan = await planChain(input());
            expect(plan).toMatchObject({ type: "full", reason: expect.stringMatching(/metadata could not be read/i) });
        });

        it("the previous index cannot be read", async () => {
            loadIndex.mockResolvedValue(null);
            const plan = await planChain(input());
            expect(plan).toMatchObject({ type: "full", reason: expect.stringMatching(/file index could not be read/i) });
        });

        it("the encryption profile changed", async () => {
            const plan = await planChain(input({ job: { ...input().job, encryptionProfileId: "profile-2" } }));
            expect(plan).toMatchObject({ type: "full", reason: expect.stringMatching(/encryption profile changed/i) });
        });

        it("encryption was turned off entirely", async () => {
            const plan = await planChain(input({ job: { ...input().job, encryptionProfileId: null } }));
            expect(plan).toMatchObject({ type: "full", reason: expect.stringMatching(/encryption profile changed/i) });
        });

        it("the exclude patterns of a source changed", async () => {
            const plan = await planChain(input({
                sources: [{ jobSourceId: "src-1", excludePatterns: ["*.log", "*.tmp"] }],
            }));
            expect(plan).toMatchObject({ type: "full", reason: expect.stringMatching(/exclude patterns/i) });
        });

        it("a directory source was added", async () => {
            const plan = await planChain(input({
                sources: [
                    { jobSourceId: "src-1", excludePatterns: ["*.log"] },
                    { jobSourceId: "src-2", excludePatterns: [] },
                ],
            }));
            expect(plan).toMatchObject({ type: "full", reason: expect.stringMatching(/set of directory sources/i) });
        });

        it("a directory source was replaced by a different one", async () => {
            const plan = await planChain(input({
                sources: [{ jobSourceId: "src-9", excludePatterns: ["*.log"] }],
            }));
            expect(plan).toMatchObject({ type: "full", reason: expect.stringMatching(/added or replaced/i) });
        });

        it("a destination is missing part of the chain", async () => {
            registryGet.mockReturnValue({
                read: vi.fn().mockResolvedValue(META),
                // Only one archive present, but the chain is two deep.
                list: vi.fn().mockResolvedValue([
                    { name: "inc-yesterday.tar", path: PREV_PATH, size: 1, lastModified: NOW },
                ]),
            });
            const plan = await planChain(input());
            expect(plan).toMatchObject({ type: "full", reason: expect.stringMatching(/missing part of the chain/i) });
        });

        it("any one of several destinations is missing part of the chain", async () => {
            // The chain is tracked per job, so a gap at a single destination restarts it
            // everywhere rather than letting destinations diverge.
            prismaMock.adapterConfig.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => ({
                id: where.id, type: "storage", adapterId: where.id, config: "{}",
            }));
            registryGet.mockImplementation((adapterId: string) => ({
                read: vi.fn().mockResolvedValue(META),
                list: vi.fn().mockResolvedValue(
                    adapterId === "dest-2"
                        ? [{ name: "inc-yesterday.tar", path: PREV_PATH, size: 1, lastModified: NOW }]
                        : [
                            { name: "full-a.tar", path: `plex/${CHAIN_DIR}/full-a.tar`, size: 1, lastModified: NOW },
                            { name: "inc-yesterday.tar", path: PREV_PATH, size: 1, lastModified: NOW },
                        ]
                ),
            }));

            const plan = await planChain(input({ destinationConfigIds: ["dest-1", "dest-2"] }));
            expect(plan).toMatchObject({ type: "full", reason: expect.stringMatching(/missing part of the chain/i) });
        });

        it("the chain's full failed its last integrity check", async () => {
            // Everything in the chain hangs off the full. Piling more snapshots onto data
            // that is known to be damaged would multiply the loss.
            prismaMock.execution.findFirst.mockImplementation(async (args: { where: { chainIndex?: number } }) =>
                args.where.chainIndex === 0
                    ? { ...previousExecution(), chainIndex: 0, path: `plex/${CHAIN_DIR}/full-a.tar`, startedAt: new Date("2026-07-20T03:00:00.000Z") }
                    : previousExecution()
            );
            registryGet.mockReturnValue({
                read: vi.fn().mockImplementation(async (_c: unknown, p: string) =>
                    p.includes("full-a.tar")
                        ? JSON.stringify({
                            version: 1,
                            archive: { formatVersion: 2, indexFile: ".index", encrypted: true, profileId: "profile-1" },
                            verification: { verifiedAt: "2026-07-21T00:00:00.000Z", passed: false, trigger: "scheduled" },
                        })
                        : META
                ),
                list: vi.fn().mockResolvedValue([]),
            });

            const plan = await planChain(input());
            expect(plan).toMatchObject({ type: "full", reason: expect.stringMatching(/full backup failed its last integrity check/i) });
        });

        it("the previous snapshot failed its last integrity check", async () => {
            registryGet.mockReturnValue({
                read: vi.fn().mockResolvedValue(JSON.stringify({
                    version: 1,
                    archive: { formatVersion: 2, indexFile: ".index", encrypted: true, profileId: "profile-1" },
                    verification: { verifiedAt: "2026-07-21T00:00:00.000Z", passed: false, trigger: "scheduled" },
                })),
                list: vi.fn().mockResolvedValue([]),
            });

            const plan = await planChain(input());
            expect(plan).toMatchObject({ type: "full", reason: expect.stringMatching(/failed its last integrity check/i) });
        });

        it("the previous backup predates the seekable format", async () => {
            registryGet.mockReturnValue({
                read: vi.fn().mockResolvedValue(JSON.stringify({ version: 1, sourceType: "mysql" })),
                list: vi.fn(),
            });
            const plan = await planChain(input());
            expect(plan).toMatchObject({ type: "full", reason: expect.stringMatching(/predates/i) });
        });
    });

    it("starts a fresh chain id whenever it degrades", async () => {
        prismaMock.execution.findFirst.mockResolvedValue(null);

        const a = await planChain(input());
        const b = await planChain(input());

        expect(a.chainId).not.toBe(b.chainId);
        expect(a.baseArchive).toBeUndefined();
        expect(a.previousIndex).toBeUndefined();
    });
});
