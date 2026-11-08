import { describe, expect, it } from "vitest";
import { changeLine, createLine, draftOf, editableBy, givableBy } from "@/components/dashboard/platform/platform-group-form";
import { PERMISSIONS } from "@/lib/auth/permissions";
import type { PlatformGroupRow, PlatformGroupsViewer } from "@/services/user/platform-groups-types";

const P = PERMISSIONS;

const row = (over: Partial<PlatformGroupRow>): PlatformGroupRow => ({
    id: "pg-support",
    name: "Support",
    builtIn: false,
    platformPermissions: [P.PLATFORM.TENANTS_READ],
    tenantPermissions: [P.JOBS.READ, P.JOBS.EXECUTE],
    allTenants: false,
    tenantIds: ["acme"],
    members: [],
    createdAt: "2026-10-02T09:00:00.000Z",
    made: null,
    changed: null,
    ...over,
});

const ADMIN_ROW = row({ id: "platform-admin", name: "Platform admin", builtIn: true, platformPermissions: [P.PLATFORM.TENANTS_WRITE, P.SETTINGS.WRITE], tenantPermissions: [P.STORAGE.DELETE], allTenants: true, tenantIds: [] });

/** Someone of Support, which sees the tenants and manages the accounts and runs jobs in Acme. */
const NINA: PlatformGroupsViewer = {
    platformAdmin: false,
    permissions: [P.PLATFORM.TENANTS_READ, P.PLATFORM.ACCOUNTS_READ, P.PLATFORM.ACCOUNTS_WRITE],
    group: { platformPermissions: [P.PLATFORM.TENANTS_READ, P.PLATFORM.ACCOUNTS_READ, P.PLATFORM.ACCOUNTS_WRITE], tenantPermissions: [P.JOBS.READ, P.JOBS.EXECUTE], allTenants: false, tenantIds: ["acme"] },
    groupId: "pg-mine",
};
const ROOT: PlatformGroupsViewer = { platformAdmin: true, permissions: [], group: null, groupId: null };

describe("which platform groups the editor lets the viewer change and give", () => {
    it("never changes Platform admin, which only a platform admin gives", () => {
        expect(editableBy(ADMIN_ROW, ROOT)).toBe(false);
        expect(givableBy(ADMIN_ROW, ROOT)).toBe(true);
        expect(givableBy(ADMIN_ROW, NINA)).toBe(false);
    });

    it("changes and gives a group within the viewer's own, never their own group, which they may still give", () => {
        expect(editableBy(row({}), NINA)).toBe(true);
        expect(editableBy(row({ id: "pg-mine" }), NINA)).toBe(false);
        expect(givableBy(row({ id: "pg-mine" }), NINA)).toBe(true);
    });

    it("leaves a group beyond the viewer read only, by a right, a tenant or All tenants", () => {
        expect(editableBy(row({ platformPermissions: [P.PLATFORM.SHARING_WRITE] }), NINA)).toBe(false);
        expect(editableBy(row({ tenantIds: ["praxis"] }), NINA)).toBe(false);
        expect(editableBy(row({ allTenants: true, tenantIds: [] }), NINA)).toBe(false);
    });
});

describe("what a new platform group starts with", () => {
    it("copies Platform admin without what the viewer may not give, and says it left something out", () => {
        const draft = draftOf({ kind: "create" }, ADMIN_ROW, NINA, ["Support"]);
        expect(draft).toEqual({ name: "Platform admin copy", platform: [], tenant: [], scope: { allTenants: false, tenantIds: ["acme"] }, trimmed: true });
    });

    it("copies a group whole for a platform admin, under a name that is free", () => {
        const draft = draftOf({ kind: "create" }, row({}), ROOT, ["Support copy"]);
        expect(draft).toMatchObject({ name: "Support copy 2", platform: [P.PLATFORM.TENANTS_READ], trimmed: false });
    });
});

describe("the line in the foot of the editor", () => {
    it("names every change of an edited group", () => {
        const before = draftOf({ kind: "edit", group: row({}) }, null, ROOT, []);
        expect(changeLine(before, "Support", new Set(before.platform), new Set(before.tenant), before.scope)).toBe("No changes yet");
        expect(changeLine(before, "Helpdesk", new Set(before.platform), new Set([P.JOBS.READ]), { allTenants: true, tenantIds: [] })).toBe("Changed: the name, Jobs Use to See, Where");
    });

    it("counts the areas of a new group and where they count", () => {
        expect(createLine(new Set([P.PLATFORM.TENANTS_READ, P.PLATFORM.SHARING_READ]), new Set([P.JOBS.READ]), { allTenants: false, tenantIds: ["acme", "shop"] })).toBe("2 areas on the platform · 1 area in 2 tenants");
    });
});
