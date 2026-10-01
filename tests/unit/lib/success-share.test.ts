import { describe, expect, it } from "vitest";
import { successShare } from "@/lib/core/success-share";

describe("the share of runs that succeeded", () => {
    it("counts the finished runs with one decimal, a partial run against it", () => {
        expect(successShare({ succeeded: 491, partial: 0, failed: 9 })).toBe(98.2);
        expect(successShare({ succeeded: 9, partial: 1, failed: 0 })).toBe(90);
        expect(successShare({ succeeded: 3, partial: 0, failed: 0 })).toBe(100);
    });

    it("is null while no run finished", () => {
        expect(successShare({ succeeded: 0, partial: 0, failed: 0 })).toBeNull();
    });

    it("gives the Overview and History the same number for the same runs", () => {
        // History hands its stats with the counts of every status, cancelled and running ones included.
        const historyStats = { total: 14, succeeded: 9, partial: 1, failed: 0, running: 3, cancelled: 1 };
        const overviewDays = { succeeded: 9, partial: 1, failed: 0 };
        expect(successShare(historyStats)).toBe(successShare(overviewDays));
    });
});
