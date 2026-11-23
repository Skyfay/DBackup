import { describe, expect, it, vi } from "vitest";
import { tenantGroupActions } from "@/components/dashboard/platform/tenant-group-actions";
import type { GroupRow } from "@/services/user/groups-types";

const row = (over: Partial<GroupRow>): GroupRow => ({
    id: "g-ops",
    name: "Operators",
    superAdmin: false,
    fromPlatform: false,
    permissions: [],
    members: [],
    createdAt: "2026-10-02T09:00:00.000Z",
    made: null,
    changed: null,
    ...over,
});

const ADMIN = row({ id: "built-in:admin", name: "Admin", superAdmin: true, fromPlatform: true });
const CLIENT = row({ id: "template:tpl-client", name: "Client", fromPlatform: true });
const OWN = row({ tenantId: "acme" });

const entries = (groups: ReturnType<typeof tenantGroupActions>) => groups.flatMap((group) => group.actions.map((action) => [action.id, action.disabled ?? false]));

describe("the menu of a row of the tenant groups", () => {
    const handlers = { onOpen: vi.fn(), onDuplicate: vi.fn(), onDelete: vi.fn(), onOpenInTenant: vi.fn() };

    it("edits, duplicates and deletes a group for tenants the viewer may change", () => {
        const groups = tenantGroupActions(CLIENT, handlers, true);
        expect(entries(groups)).toEqual([["edit", false], ["duplicate", false], ["delete", false]]);
        groups[0].actions[1].onSelect();
        expect(handlers.onDuplicate).toHaveBeenCalledWith(CLIENT);
    });

    it("only views one beyond the viewer, and only views it without the right to manage", () => {
        expect(entries(tenantGroupActions(CLIENT, handlers, false))).toEqual([["view", false], ["duplicate", false]]);
        expect(entries(tenantGroupActions(CLIENT, { onOpen: vi.fn() }, false))).toEqual([["view", false]]);
    });

    it("shows Edit and Delete of the built-in Admin off, and nothing to someone who only sees", () => {
        expect(entries(tenantGroupActions(ADMIN, handlers, false))).toEqual([["edit", true], ["delete", true]]);
        expect(tenantGroupActions(ADMIN, { onOpen: vi.fn() }, false)).toEqual([]);
    });

    it("opens the own group of a tenant there, where the viewer may open it", () => {
        const groups = tenantGroupActions(OWN, handlers, false);
        expect(entries(groups)).toEqual([["open-in-tenant", false]]);
        groups[0].actions[0].onSelect();
        expect(handlers.onOpenInTenant).toHaveBeenCalledWith(OWN);
        expect(tenantGroupActions(OWN, { ...handlers, onOpenInTenant: undefined }, false)).toEqual([]);
    });
});
