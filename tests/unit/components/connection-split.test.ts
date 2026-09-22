import { describe, it, expect } from "vitest";
import { resolveSelection, splitGroups } from "@/components/adapter/connection-split";
import type { AdapterConfig } from "@/components/adapter/types";

const config = (id: string, lastStatus = "ONLINE"): AdapterConfig => ({
    id,
    name: id,
    adapterId: "postgres",
    type: "database",
    config: "{}",
    createdAt: "2026-09-01T00:00:00.000Z",
    lastHealthCheck: "2026-09-22T12:00:00.000Z",
    lastStatus,
});

describe("splitGroups", () => {
    it("puts the connections with problems first under their own heading", () => {
        const groups = splitGroups([config("prod"), config("analytics", "OFFLINE"), config("erp", "DEGRADED")], true);

        expect(groups.map((group) => [group.label, group.items.map((item) => item.id)])).toEqual([
            ["Needs attention", ["analytics", "erp"]],
            ["Everything else", ["prod"]],
        ]);
    });

    it("needs no headings while nothing is wrong", () => {
        expect(splitGroups([config("prod"), config("shop")], true)).toEqual([{ label: null, items: [config("prod"), config("shop")] }]);
    });

    it("ignores the health of notification channels, which have none", () => {
        expect(splitGroups([config("discord", "OFFLINE")], false)[0].label).toBeNull();
    });
});

describe("resolveSelection", () => {
    it("keeps the picked connection while it is listed and falls back to the first one otherwise", () => {
        const groups = splitGroups([config("prod"), config("analytics", "OFFLINE")], true);

        expect(resolveSelection(groups, "prod")?.id).toBe("prod");
        // Filtered out or deleted: the first listed one, which is the problem.
        expect(resolveSelection(groups, "gone")?.id).toBe("analytics");
        expect(resolveSelection([{ label: null, items: [] }], "prod")).toBeNull();
    });
});
