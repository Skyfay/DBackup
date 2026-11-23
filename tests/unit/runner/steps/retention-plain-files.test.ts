/**
 * Only an archive a run wrote counts toward the policy of a job. A plain file in the folder of the
 * job, like one a file restore wrote there, has no sidecar. It took a keep slot and pushed real
 * backups out, deleted by someone without the right to delete backups.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FileInfo } from "@/lib/core/interfaces";
import type { RunnerContext, DestinationContext } from "@/lib/runner/types";

vi.mock("@/lib/logging/logger", () => ({
    logger: { child: vi.fn().mockReturnValue({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}));
vi.mock("@/services/dashboard-service", () => ({ refreshStorageStatsCache: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/services/storage/storage-service", () => ({
    storageService: {
        removeStorageListCacheEntry: vi.fn().mockResolvedValue(undefined),
        readCachedListing: vi.fn().mockResolvedValue(null),
    },
}));
vi.mock("@/lib/prisma", () => ({ default: { systemSetting: { findUnique: vi.fn().mockResolvedValue(null) } } }));

// The step loads the storage service only when it deletes, without waiting for it. Loaded here, that
// import answers from the module cache while the test still runs, never after its teardown.
await import("@/services/storage/storage-service");
const { stepRetention } = await import("@/lib/runner/steps/05-retention");

const NOW = Date.UTC(2026, 10, 10, 12, 0);
const ago = (minutes: number) => new Date(NOW - minutes * 60_000);
const DAY = 24 * 60;

/** A destination in memory: path to modification time and, for a sidecar, its content. */
class Destination {
    files = new Map<string, { modified: Date; content?: string }>();
    deleted: string[] = [];

    backup(path: string, minutesAgo: number, meta: Record<string, unknown> = {}) {
        this.files.set(path, { modified: ago(minutesAgo) });
        this.files.set(`${path}.meta.json`, {
            modified: ago(minutesAgo),
            content: JSON.stringify({ jobId: "job-1", timestamp: ago(minutesAgo).toISOString(), ...meta }),
        });
    }
    plain(path: string, minutesAgo: number) {
        this.files.set(path, { modified: ago(minutesAgo) });
    }
    adapter() {
        return {
            list: vi.fn(async (): Promise<FileInfo[]> => [...this.files].map(([path, file]) => ({
                name: path.split("/").at(-1)!, path, size: 10, lastModified: file.modified,
            }))),
            read: vi.fn(async (_config: unknown, path: string) => this.files.get(path)?.content ?? null),
            delete: vi.fn(async (_config: unknown, path: string) => {
                if (this.files.delete(path) && !path.endsWith(".meta.json")) this.deleted.push(path);
            }),
        };
    }
}

async function runRetention(destination: Destination, uploaded: string, incremental = false) {
    const dest = {
        configId: "cfg-1", configName: "S3", adapterId: "s3", config: {}, priority: 0,
        retention: { mode: "SIMPLE", simple: { keepCount: 3 } },
        adapter: destination.adapter(),
        uploadResult: { success: true, path: uploaded },
    } as unknown as DestinationContext;
    const ctx = {
        jobId: "job-1",
        job: { id: "job-1", name: "nightly", backupMode: incremental ? "INCREMENTAL" : "FULL" },
        ...(incremental ? { chain: { type: "incremental", chainId: "new", index: 2 } } : {}),
        logs: [], log: vi.fn(), destinations: [dest], status: "Success", startedAt: new Date(NOW),
    } as unknown as RunnerContext;
    await stepRetention(ctx);
    // The step drops the deleted paths from the cached listing without waiting for it. One turn of
    // the loop lets that finish while the test still runs, never after its teardown.
    await new Promise((resolve) => setTimeout(resolve, 0));
    return destination.deleted.sort();
}

/** Four backups of the job, one a day, the newest written ten minutes ago by the run. */
function fourBackups(): Destination {
    const destination = new Destination();
    destination.backup("nightly/b1.tar", 3 * DAY);
    destination.backup("nightly/b2.tar", 2 * DAY);
    destination.backup("nightly/b3.tar", DAY);
    destination.backup("nightly/b4.tar", 10);
    return destination;
}

describe("retention of a job whose folder holds files no run wrote", () => {
    beforeEach(() => vi.clearAllMocks());

    it("deletes only the oldest backup when the folder holds backups alone", async () => {
        expect(await runRetention(fourBackups(), "nightly/b4.tar")).toEqual(["nightly/b1.tar"]);
    });

    it("gives restored plain files no keep slot, so they push no backup out", async () => {
        const destination = fourBackups();
        destination.plain("nightly/notes-1.txt", 120);
        destination.plain("nightly/notes-2.txt", 60);

        expect(await runRetention(destination, "nightly/b4.tar")).toEqual(["nightly/b1.tar"]);
        expect(destination.files.has("nightly/notes-1.txt")).toBe(true);
    });

    it("keeps the backup of the run when plain files newer than it were written during the upload", async () => {
        const destination = fourBackups();
        for (const [name, minutes] of [["n1.txt", 5], ["n2.txt", 4], ["n3.txt", 3]] as const) destination.plain(`nightly/${name}`, minutes);

        expect(await runRetention(destination, "nightly/b4.tar")).toEqual(["nightly/b1.tar"]);
    });

    it("gives plain files in a folder named like a chain no keep slot either", async () => {
        const destination = fourBackups();
        for (const [name, minutes] of [["a.txt", 5], ["b.txt", 4], ["c.txt", 3]] as const) {
            destination.plain(`nightly/chain-2026-01-01T00-00-00-000/${name}`, minutes);
        }

        expect(await runRetention(destination, "nightly/b4.tar")).toEqual(["nightly/b1.tar"]);
    });

    it("deletes nothing of a chain with a member that lost its sidecar", async () => {
        const destination = new Destination();
        const old = "nightly/chain-2026-11-01T00-00-00-000";
        const current = "nightly/chain-2026-11-08T00-00-00-000";
        destination.backup(`${old}/f.tar`, 9 * DAY, { chain: { id: "old", type: "full" } });
        destination.plain(`${old}/i1.tar`, 8 * DAY);
        destination.backup(`${old}/i2.tar`, 7 * DAY, { chain: { id: "old", type: "incremental" } });
        destination.backup(`${current}/f.tar`, 2 * DAY, { chain: { id: "new", type: "full" } });
        destination.backup(`${current}/i1.tar`, DAY, { chain: { id: "new", type: "incremental" } });
        destination.backup(`${current}/i2.tar`, 10, { chain: { id: "new", type: "incremental" } });

        expect(await runRetention(destination, `${current}/i2.tar`, true)).toEqual([]);
    });

    it("still deletes a whole expired chain whose members all have their sidecars", async () => {
        const destination = new Destination();
        const old = "nightly/chain-2026-11-01T00-00-00-000";
        const current = "nightly/chain-2026-11-08T00-00-00-000";
        destination.backup(`${old}/f.tar`, 9 * DAY, { chain: { id: "old", type: "full" } });
        destination.backup(`${old}/i1.tar`, 8 * DAY, { chain: { id: "old", type: "incremental" } });
        destination.backup(`${current}/f.tar`, 2 * DAY, { chain: { id: "new", type: "full" } });
        destination.backup(`${current}/i1.tar`, DAY, { chain: { id: "new", type: "incremental" } });
        destination.backup(`${current}/i2.tar`, 10, { chain: { id: "new", type: "incremental" } });

        expect(await runRetention(destination, `${current}/i2.tar`, true)).toEqual([`${old}/f.tar`, `${old}/i1.tar`]);
    });
});
