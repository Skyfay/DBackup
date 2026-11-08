import { describe, expect, it } from "vitest";
import { draftsOf, tenantChangeLine, tenantRoleChanges, tenantRoleRows } from "@/components/dashboard/users/user-tenant-roles";
import type { UserTenantRole } from "@/services/user/users-types";

const NAMES: Record<string, string> = { default: "Skyfay Hosting", acme: "Acme GmbH", shop: "Shop", globex: "Globex" };
const nameOf = (tenantId: string) => NAMES[tenantId] ?? null;

/** Works in the home tenant as Admin, in Acme as Client and in Shop as Viewer. */
const BEFORE: UserTenantRole[] = [
    { tenantId: "shop", group: { id: "g-shop-viewer", name: "Viewer" } },
    { tenantId: "default", group: { id: "g-home-admin", name: "Admin" } },
    { tenantId: "acme", group: { id: "g-acme-client", name: "Client" } },
];

describe("the tenants of an account in Edit user", () => {
    it("changes nothing on Save while nothing was touched", () => {
        expect(tenantRoleChanges(BEFORE, draftsOf(BEFORE))).toEqual([]);
        expect(tenantChangeLine([], BEFORE, nameOf)).toBeNull();
    });

    it("saves another group, a new tenant and a tenant it leaves, the leaving last", () => {
        const after = [
            { tenantId: "default", groupId: "g-home-admin" },
            { tenantId: "acme", groupId: "g-acme-admin" },
            { tenantId: "globex", groupId: "g-globex-client" },
        ];
        const changes = tenantRoleChanges(BEFORE, after);

        expect(changes).toEqual([
            { tenantId: "acme", groupId: "g-acme-admin" },
            { tenantId: "globex", groupId: "g-globex-client" },
            { tenantId: "shop", groupId: null },
        ]);
        expect(tenantChangeLine(changes, BEFORE, nameOf)).toBe("Joins Globex, another group in Acme GmbH, leaves Shop");
    });

    it("lists every tenant with what Save does there, the home tenant first", () => {
        const rows = tenantRoleRows(BEFORE, [
            { tenantId: "default", groupId: "g-home-admin" },
            { tenantId: "acme", groupId: "g-acme-admin" },
            { tenantId: "globex", groupId: "g-globex-client" },
        ], nameOf);

        expect(rows.map((row) => [row.tenantName, row.state, row.groupId])).toEqual([
            ["Skyfay Hosting", "same", "g-home-admin"],
            ["Acme GmbH", "changed", "g-acme-admin"],
            ["Globex", "new", "g-globex-client"],
            ["Shop", "removed", "g-shop-viewer"],
        ]);
    });

    it("names a tenant it does not know by its id", () => {
        expect(tenantRoleRows([{ tenantId: "gone", group: { id: "g", name: "Viewer" } }], [], nameOf)[0]).toMatchObject({ tenantName: "gone", state: "removed" });
    });
});
