import { describe, it, expect } from "vitest";
import { ADAPTER_DEFINITIONS } from "@/lib/adapters/definitions";

describe("adapter groups", () => {
    // The picker lists every type under its group heading, so one without a group would end
    // up under an empty heading of its own.
    it("gives every adapter a group", () => {
        const ungrouped = ADAPTER_DEFINITIONS.filter((adapter) => !adapter.group).map((adapter) => adapter.id);

        expect(ungrouped).toEqual([]);
    });

    it("sorts each kind into a handful of groups, so the headings stay meaningful", () => {
        for (const type of ["database", "storage", "notification"] as const) {
            const groups = new Set(ADAPTER_DEFINITIONS.filter((adapter) => adapter.type === type).map((adapter) => adapter.group));

            expect(groups.size, `${type} groups`).toBeGreaterThan(1);
            expect(groups.size, `${type} groups`).toBeLessThanOrEqual(6);
        }
    });
});
