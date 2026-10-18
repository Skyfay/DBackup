import { describe, expect, it } from "vitest";
import { accountRefusal, roleRefusal } from "@/lib/auth/account-access";
import { AVAILABLE_PERMISSIONS, PERMISSIONS } from "@/lib/auth/permissions";
import { HOME_TENANT_ID } from "@/lib/tenant/home";
import { accountLock, groupBeyond, groupGrants, groupLock, HELD_GROUP_BEYOND_YOU } from "@/components/dashboard/users/user-access";
import { moveBlocker } from "@/components/dashboard/groups/group-move-dialog";
import { groupTargets } from "@/components/dashboard/groups/group-delete-dialog";
import { leftOutNote } from "@/components/dashboard/users/user-group-picker";
import type { GroupRow } from "@/services/user/groups-types";

const ALL = AVAILABLE_PERMISSIONS.map((permission) => permission.id);
const OPERATOR = [PERMISSIONS.USERS.READ, PERMISSIONS.USERS.WRITE, PERMISSIONS.JOBS.READ, PERMISSIONS.JOBS.EXECUTE];

const person = (over: Partial<{ superAdmin: boolean; elsewhere: boolean; isYou: boolean }> = {}) => ({ superAdmin: false, elsewhere: false, isYou: false, ...over });

const group = (id: string, permissions: string[], superAdmin = false): GroupRow => ({
    id,
    name: id,
    superAdmin,
    fromPlatform: false,
    permissions,
    members: [],
    createdAt: "2026-10-01T00:00:00.000Z",
    made: null,
    changed: null,
});

describe("what a tenant admin may change of an account", () => {
    it("leaves the account of a platform admin to a platform admin", () => {
        expect(accountLock(person({ superAdmin: true }), false)).toBe("Only a platform admin can change the account of a platform admin.");
        expect(accountLock(person({ superAdmin: true }), true)).toBeNull();
    });

    it("leaves an account that works in other tenants to a platform admin", () => {
        expect(accountLock(person({ elsewhere: true }), false)).toBe("This account also works in other tenants. Only someone who manages the accounts of the platform can change it.");
        expect(accountLock(person({ elsewhere: true }), true)).toBeNull();
    });

    it("changes an account that works here alone, and always the own one", () => {
        expect(accountLock(person(), false)).toBeNull();
        expect(accountLock(person({ elsewhere: true, isYou: true }), false)).toBeNull();
    });

    it("lets whoever manages the accounts of the platform change an account of other tenants too, never that of a platform admin, like the server", () => {
        const manager = { isPlatformAdmin: false, tenantId: "t1", permissions: [PERMISSIONS.PLATFORM.ACCOUNTS_WRITE], reach: "all" as const };
        expect(accountLock(person({ elsewhere: true }), false, true)).toBeNull();
        expect(accountRefusal(manager, { isPlatformAdmin: false, tenantIds: ["t1", "t2"] })).toBeNull();
        expect(accountLock(person({ superAdmin: true }), false, true)).toBe(accountRefusal(manager, { isPlatformAdmin: true, tenantIds: ["t1"] }));
    });

    it("locks an account beyond the tenants of the manager's platform group, like the server", () => {
        const manager = { isPlatformAdmin: false, tenantId: "t1", permissions: [PERMISSIONS.PLATFORM.ACCOUNTS_WRITE], reach: ["t1"] };
        expect(accountLock({ ...person({ elsewhere: true }), beyondReach: true }, false, true)).toBe(accountRefusal(manager, { isPlatformAdmin: false, tenantIds: ["t1", "t2"] }));
        expect(accountLock({ ...person({ elsewhere: true }), beyondReach: false }, false, true)).toBeNull();
        // A tenant admin of a customer that holds such a platform group too keeps the account of their tenant alone.
        expect(accountLock({ ...person(), beyondReach: true }, false, true)).toBeNull();
    });

    it("says what the server says when it refuses", () => {
        const actor = { isPlatformAdmin: false, tenantId: "t1", permissions: OPERATOR };
        expect(accountLock(person({ superAdmin: true }), false)).toBe(accountRefusal(actor, { isPlatformAdmin: true, tenantIds: ["t1"] }));
        expect(accountLock(person({ elsewhere: true }), false)).toBe(accountRefusal(actor, { isPlatformAdmin: false, tenantIds: ["t1", "t2"] }));
    });
});

describe("which groups a viewer may give", () => {
    const operator = { platformAdmin: false, permissions: OPERATOR };

    it("gives the group with every permission only to a viewer who holds every permission or is a platform admin", () => {
        const full = group("admin", [], true);
        expect(groupBeyond(full, operator)).toBe(true);
        expect(groupBeyond(full, { platformAdmin: false, permissions: ALL })).toBe(false);
        expect(groupBeyond(full, { platformAdmin: true, permissions: [] })).toBe(false);
    });

    it("leaves out a group that may do more than the viewer, like the server in the home tenant", () => {
        const deleter = group("deleter", [PERMISSIONS.JOBS.READ, PERMISSIONS.STORAGE.DELETE]);
        const viewer = group("viewer", [PERMISSIONS.JOBS.READ]);
        const actor = { isPlatformAdmin: false, tenantId: HOME_TENANT_ID, permissions: OPERATOR };

        expect(groupBeyond(deleter, operator)).toBe(true);
        expect(roleRefusal(actor, { permissions: JSON.stringify(deleter.permissions), fullAccess: false })).not.toBeNull();
        expect(groupBeyond(viewer, operator)).toBe(false);
        expect(roleRefusal(actor, { permissions: JSON.stringify(viewer.permissions), fullAccess: false })).toBeNull();
    });

    it("counts only the permissions DBackup knows, like the server", () => {
        expect(groupGrants(group("old", [PERMISSIONS.JOBS.READ, "gone:permission"]))).toEqual([PERMISSIONS.JOBS.READ]);
        expect(groupBeyond(group("old", [PERMISSIONS.JOBS.READ, "gone:permission"]), operator)).toBe(false);
    });

    it("hides nothing outside the dashboard, where nobody knows the permissions", () => {
        expect(groupBeyond(group("admin", [], true), { platformAdmin: false, permissions: null })).toBe(false);
    });

    it("says why some groups are not listed", () => {
        expect(leftOutNote([])).toBeNull();
        expect(leftOutNote(["Admin"])).toBe("Admin may do more than you may, so it is not listed");
        expect(leftOutNote(["Admin", "Deleters"])).toBe("2 groups may do more than you may, so they are not listed");
    });
});

describe("whose group a viewer may change", () => {
    const groups = [group("admin", [], true), group("viewer", [PERMISSIONS.JOBS.READ])];
    const operator = { platformAdmin: false, permissions: OPERATOR };

    it("never the own group", () => {
        expect(groupLock({ isYou: true, group: { id: "viewer", name: "viewer" } }, groups, operator)).toBe("Another admin changes your own group.");
    });

    it("not of someone whose group may do more than the viewer", () => {
        expect(groupLock({ isYou: false, group: { id: "admin", name: "admin" } }, groups, operator)).toBe(HELD_GROUP_BEYOND_YOU);
        expect(groupLock({ isYou: false, group: { id: "admin", name: "admin" } }, groups, { platformAdmin: true, permissions: [] })).toBeNull();
    });

    it("of someone in a smaller group or in none", () => {
        expect(groupLock({ isYou: false, group: { id: "viewer", name: "viewer" } }, groups, operator)).toBeNull();
        expect(groupLock({ isYou: false, group: null }, groups, operator)).toBeNull();
    });

    it("moves people only out of and into groups within the viewer's reach", () => {
        expect(moveBlocker({ isYou: true, groupId: "viewer" }, groups, operator)).toBe("You");
        expect(moveBlocker({ isYou: false, groupId: "admin" }, groups, operator)).toBe("Their group may do more than you may");
        expect(moveBlocker({ isYou: false, groupId: "viewer" }, groups, operator)).toBeNull();
        expect(moveBlocker({ isYou: false, groupId: null }, groups, operator)).toBeNull();
    });

    it("offers as the new group of members only the groups within reach, and none", () => {
        expect(groupTargets(groups, null, operator).map((option) => option.value)).toEqual(["viewer", "none"]);
        expect(groupTargets(groups, "viewer", { platformAdmin: true, permissions: [] }).map((option) => option.value)).toEqual(["admin", "none"]);
    });
});
