import { describe, expect, it, vi } from "vitest";
import type { FileInfo, StorageAdapter } from "@/lib/core/interfaces";
import { RetentionService } from "@/services/backup/retention-service";
import { loadBackupSidecars } from "@/lib/runner/steps/retention-sidecars";

const day = (ago: number) => new Date(Date.UTC(2026, 10, 8 - ago, 4, 0));
const file = (relative: string, ago: number, extra: Partial<FileInfo> = {}): FileInfo => ({
    path: `/job/${relative}`,
    name: relative.split("/").at(-1)!,
    size: 1024,
    lastModified: day(ago),
    ...extra,
});
const keepNewest = { mode: "SIMPLE" as const, simple: { keepCount: 1 } };
const decide = (files: FileInfo[]) => RetentionService.calculateRetention(files, keepNewest);

describe("incremental retention protects complete chain folders without blocking unrelated backups", () => {
    it("preserves a FULL with unreadable metadata and its increments, but prunes an unrelated flat backup", () => {
        const newest = file("chain-new/full-000-new.tar", 0, { chainId: "new", chainType: "full" });
        const missingMetaFull = file("chain-old/full-000-old.tar", 12, { chainMetadataUnsafe: true });
        const increment = file("chain-old/inc-001-old.tar", 11, { chainId: "old", chainType: "incremental" });
        const flat = file("legacy-flat.tar", 14);
        const result = decide([flat, missingMetaFull, newest, increment]);
        expect(result.keep).toContain(newest);
        expect(result.keep).toContain(missingMetaFull);
        expect(result.keep).toContain(increment);
        expect(result.delete).toEqual([flat]);
    });

    it("retains a valid FULL regardless of name template when its incremental is selected", () => {
        const full = file("chain-current/custom-name-prefix.tar", 2, { chainId: "current", chainType: "full" });
        const inc = file("chain-current/any-custom-template.tar", 0, { chainId: "current", chainType: "incremental" });
        const oldFull = file("chain-previous/a.tar", 21, { chainId: "previous", chainType: "full" });
        const oldInc = file("chain-previous/b.tar", 20, { chainId: "previous", chainType: "incremental" });
        const result = decide([oldFull, full, inc, oldInc]);
        expect(result.keep).toEqual(expect.arrayContaining([inc, full]));
        expect(result.delete).toEqual(expect.arrayContaining([oldFull, oldInc]));
        expect(result.delete).toHaveLength(2);
    });

    it("preserves orphaned incrementals, while older independent backups can be deleted", () => {
        const latest = file("flat-latest.tar", 0);
        const orphan = file("chain-orphan/inc-001.tar", 18, { chainId: "orphan", chainType: "incremental" });
        const oldFlat = file("flat-before.tar", 25);
        const result = decide([orphan, oldFlat, latest]);
        expect(result.keep).toContain(orphan);
        expect(result.delete).toEqual([oldFlat]);
    });

    it("does not disable retention permanently for historic flat FULLs or adapters without read()", () => {
        const recent = file("chain-latest/full-000.tar", 0);
        const recentInc = file("chain-latest/inc-001.tar", 1);
        const oldFull = file("chain-older/full-000.tar", 13);
        const oldInc = file("chain-older/inc-001.tar", 12);
        const flat = file("old-full-before-job-switch.tar", 40);
        const result = decide([flat, oldInc, recentInc, oldFull, recent]);
        expect(result.keep).toEqual(expect.arrayContaining([recent, recentInc]));
        expect(result.delete).toEqual(expect.arrayContaining([flat, oldFull, oldInc]));
        expect(result.delete).toHaveLength(3);
    });

    it("detects a missing FULL sidecar from real listing shape and preserves that folder", async () => {
        const full = file("chain-2026-10-01T02-00-00-000/full-000-any.tar", 15);
        const inc = file("chain-2026-10-01T02-00-00-000/inc-001-any.tar", 14);
        const latest = file("flat-latest.tar", 0);
        const sidecar = file("chain-2026-10-01T02-00-00-000/inc-001-any.tar.meta.json", 14);
        const adapter = {
            read: vi.fn(async () => JSON.stringify({
                timestamp: day(14).toISOString(), jobId: "job", chain: { id: "oct", type: "incremental" },
            })),
        } as unknown as StorageAdapter;
        await loadBackupSidecars(adapter, {}, [full, inc, latest, sidecar], [full, inc, latest]);
        expect(full.chainMetadataUnsafe).toBe(true);
        expect(inc.chainType).toBe("incremental");
        expect(decide([full, inc, latest]).keep).toEqual(expect.arrayContaining([full, inc, latest]));
        expect(adapter.read).toHaveBeenCalledTimes(1);
    });
});
