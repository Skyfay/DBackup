import { describe, expect, it } from "vitest";
import { FileInfo } from "@/lib/core/interfaces";
import { assertIncrementalRetentionSafe } from "@/lib/runner/steps/retention-sidecars";

function archive(name: string, chainId?: string, withTime = true): FileInfo {
    const time = new Date("2026-10-31T04:10:00Z");
    return {
        name,
        path: "/job/" + name,
        size: 1024,
        lastModified: time,
        ...(chainId ? { chainId } : {}),
        ...(withTime ? { backupTimestamp: time } : {}),
    };
}

describe("fail-closed incremental retention", () => {
    it("allows complete chain with FULL and incrementals", () => {
        expect(() => assertIncrementalRetentionSafe([
            archive("job_2026-10-30_full-000.tar", "chain-oct"),
            archive("job_2026-10-31_inc-001.tar", "chain-oct"),
            archive("job_2026-11-06_full-000.tar", "chain-nov"),
            archive("job_2026-11-07_inc-001.tar", "chain-nov"),
        ])).not.toThrow();
    });
    it("refuses chainless FULL after sidecar read failure", () => {
        expect(() => assertIncrementalRetentionSafe([
            archive("job_2026-10-30_full-000.tar"), // sidecar unreadable
            archive("job_2026-10-31_inc-001.tar", "chain-oct"),
        ])).toThrow(/missing or invalid metadata/);
    });
    it("refuses preexisting orphaned incremental chain", () => {
        expect(() => assertIncrementalRetentionSafe([
            archive("job_2026-10-31_inc-001.tar", "chain-oct"),
            archive("job_2026-11-06_full-000.tar", "chain-nov"),
        ])).toThrow(/lack a FULL base/);
    });
    it("refuses a missing timestamp for incremental chain", () => {
        expect(() => assertIncrementalRetentionSafe([
            archive("job_2026-11-06_full-000.tar", "chain-nov", false),
        ])).toThrow(/missing or invalid metadata/);
    });
});
