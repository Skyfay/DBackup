/**
 * Sentences that count: the note of a connection another tenant stopped sharing agrees its verb
 * with the number, and the count of tenants names only the tenants the viewer sees.
 */
import { describe, expect, it } from "vitest";
import { lossOf } from "@/components/adapter/connection-withdrawn";
import { tenantsCountLine } from "@/components/dashboard/tenants/tenants-strip";
import type { WithdrawnConnection } from "@/services/sharing/withdrawn";

const note = (overrides: Partial<WithdrawnConnection>): WithdrawnConnection => ({
    id: "entry-1", configId: "nas", name: "MSP NAS", kind: "destination", at: "2026-10-01T10:00:00.000Z", jobs: [], templates: [], backups: 0, ...overrides,
});

describe("the note of a connection that is no longer shared", () => {
    it("says one job writes and one template sends, in the singular", () => {
        expect(lossOf(note({ backups: 1, jobs: ["Nightly"] }))).toBe("1 backup of this tenant on it was deleted. 1 job no longer writes to it: Nightly. Give it another destination.");
        expect(lossOf(note({ kind: "channel", jobs: ["Nightly"], templates: ["Failures"] }))).toBe("1 job no longer tells it: Nightly. 1 template no longer sends to it: Failures.");
    });

    it("says several jobs write and several templates send, in the plural", () => {
        expect(lossOf(note({ backups: 4, jobs: ["Nightly", "Hourly"] }))).toBe("4 backups of this tenant on it were deleted. 2 jobs no longer write to it: Nightly, Hourly. Give them another destination.");
        expect(lossOf(note({ kind: "channel", jobs: ["A", "B"], templates: ["X", "Y"] }))).toBe("2 jobs no longer tell it: A, B. 2 templates no longer send to it: X, Y.");
    });
});

describe("the count of tenants", () => {
    it("names the home tenant only to a viewer who sees it", () => {
        expect(tenantsCountLine([{ isHome: true }, { isHome: false }, { isHome: false }])).toBe("the home tenant and 2 customers");
        expect(tenantsCountLine([{ isHome: false }, { isHome: false }])).toBe("2 customers");
        expect(tenantsCountLine([{ isHome: false }])).toBe("1 customer");
    });
});
