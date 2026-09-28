import { describe, expect, it } from "vitest";
import { howReached } from "@/services/templates/retention-targets";
import { mostKept, removedByNextRun } from "@/services/templates/retention-preview";
import type { RetentionTarget } from "@/services/templates/templates-types";

const DAY = 86_400_000;
const NOW = Date.parse("2026-09-28T12:00:00Z");

/** A destination holding one backup a day for the last `days` days. */
function target(days: number, overrides: Partial<RetentionTarget> = {}): RetentionTarget {
    return {
        jobId: "shop",
        jobName: "Shop nightly",
        destinationId: "nas",
        destinationName: "NAS",
        adapterId: "smb",
        how: "picked",
        nextRun: new Date(NOW + DAY / 2).toISOString(),
        chains: false,
        backups: Array.from({ length: days }, (_, index) => ({ at: new Date(NOW - (index + 1) * DAY).toISOString(), locked: false, chainId: null })),
        ...overrides,
    };
}

describe("removedByNextRun", () => {
    it("counts the backups the next run pushes out, after it added its own", () => {
        // Ten backups and the new one, of which the newest five stay.
        expect(removedByNextRun(target(10), { mode: "SIMPLE", simple: { keepCount: 5 } }, "UTC", NOW)).toBe(6);
    });

    it("removes nothing for a policy that keeps everything", () => {
        expect(removedByNextRun(target(40), { mode: "NONE" }, "UTC", NOW)).toBe(0);
    });

    it("leaves a locked backup where it is", () => {
        const held = target(4);
        held.backups[3] = { ...held.backups[3], locked: true };
        expect(removedByNextRun(held, { mode: "SIMPLE", simple: { keepCount: 2 } }, "UTC", NOW)).toBe(2);
    });

    it("judges a paused job as if it ran now", () => {
        expect(removedByNextRun(target(3, { nextRun: null }), { mode: "SIMPLE", simple: { keepCount: 1 } }, "UTC", NOW)).toBe(3);
    });
});

describe("mostKept", () => {
    it("adds the tiers of a smart policy up", () => {
        expect(mostKept({ mode: "SMART", smart: { hourly: 0, daily: 5, weekly: 4, monthly: 12, yearly: 2 } })).toBe(23);
    });

    it("has no limit for a policy that keeps everything", () => {
        expect(mostKept({ mode: "NONE" })).toBeNull();
        expect(mostKept({ mode: "SIMPLE", simple: { keepCount: 14 } })).toBe(14);
    });
});

describe("howReached", () => {
    const own = { retention: "{\"mode\":\"SIMPLE\",\"simple\":{\"keepCount\":3}}", retentionPolicyId: null };
    const none = { retention: "{}", retentionPolicyId: null };
    const picked = { retention: "{}", retentionPolicyId: "keep14" };

    it("reaches the destinations that picked a policy", () => {
        expect(howReached(picked, { policyId: "keep14" }, "gfs")).toBe("picked");
        expect(howReached(picked, { policyId: "gfs" }, "gfs")).toBeNull();
    });

    it("reaches the destinations without a policy of their own through the default only", () => {
        expect(howReached(none, { policyId: "gfs" }, "gfs")).toBe("default");
        expect(howReached(none, { policyId: "keep14" }, "gfs")).toBeNull();
        expect(howReached(own, { policyId: "gfs" }, "gfs")).toBeNull();
    });

    it("finds the followers of whatever policy a new default would replace", () => {
        expect(howReached(none, { followers: true }, null)).toBe("default");
        expect(howReached(picked, { followers: true }, "gfs")).toBeNull();
        expect(howReached(own, { followers: true }, "gfs")).toBeNull();
    });
});
