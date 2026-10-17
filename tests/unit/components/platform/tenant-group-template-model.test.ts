import { describe, expect, it } from "vitest";
import { adminRow, draftOf, isBuiltInRow, isTemplateRow, presetRights, startName } from "@/components/dashboard/platform/tenant-group-template-model";
import { CLIENT_TEMPLATE, GROUP_TEMPLATES, TENANT_GROUP_TEMPLATES } from "@/lib/auth/group-templates";
import { PLATFORM_PERMISSIONS } from "@/lib/auth/owner-permissions";
import type { PlatformGroupActor } from "@/lib/auth/platform-group-caps";
import { PERMISSIONS } from "@/lib/auth/permissions";
import type { GroupRow, TenantGroupTemplateRow } from "@/services/user/groups-types";

const P = PERMISSIONS;
const member = (id: string, name: string) => ({ id, name, email: `${id}@example.com`, image: null, isYou: false });

const group = (over: Partial<GroupRow>): GroupRow => ({
    id: "g-ops",
    name: "Operators",
    superAdmin: false,
    fromPlatform: false,
    permissions: [P.JOBS.READ],
    members: [],
    createdAt: "2026-10-02T09:00:00.000Z",
    made: null,
    changed: null,
    ...over,
});

const template = (over: Partial<TenantGroupTemplateRow>): TenantGroupTemplateRow => ({
    id: "tpl-support",
    name: "Support",
    permissions: [P.JOBS.READ, P.JOBS.EXECUTE, P.HISTORY.READ],
    allTenants: false,
    tenantIds: ["acme", "shop"],
    groups: [
        { tenantId: "acme", groupId: "g-acme", members: [] },
        { tenantId: "shop", groupId: "g-shop", members: [] },
    ],
    createdAt: "2026-10-03T09:00:00.000Z",
    made: null,
    changed: null,
    ...over,
});

const ROOT: PlatformGroupActor = { isPlatformAdmin: true, permissions: [], group: null };
/** Someone of a platform group that gives jobs and the history in Acme alone. */
const NINA: PlatformGroupActor = {
    isPlatformAdmin: false,
    permissions: [P.PLATFORM.ACCOUNTS_WRITE],
    group: { platformPermissions: [P.PLATFORM.ACCOUNTS_WRITE], tenantPermissions: [P.JOBS.READ, P.HISTORY.READ, P.SOURCES.VIEW], allTenants: false, tenantIds: ["acme"] },
};

describe("the built-in Admin on the list of the tenant groups", () => {
    it("shows the Admin of every tenant once, with everyone who holds one of them", () => {
        const row = adminRow([
            group({ id: "a-acme", name: "Admin", superAdmin: true, tenantId: "acme", members: [member("lena", "Lena"), member("ada", "Ada")], createdAt: "2026-10-05T09:00:00.000Z" }),
            group({ id: "a-shop", name: "Admin", superAdmin: true, tenantId: "shop", members: [member("lena", "Lena")], createdAt: "2026-10-01T09:00:00.000Z" }),
            group({ tenantId: "acme", members: [member("tom", "Tom")] }),
        ]);

        expect(row).toMatchObject({ name: "Admin", superAdmin: true, fromPlatform: true, createdAt: "2026-10-01T09:00:00.000Z" });
        expect(row?.members.map((entry) => entry.name)).toEqual(["Ada", "Lena"]);
        expect(isBuiltInRow(row!)).toBe(true);
        expect(isTemplateRow(row!)).toBe(false);
    });

    it("shows none without a tenant", () => {
        expect(adminRow([group({})])).toBeNull();
        expect(isBuiltInRow(group({}))).toBe(false);
    });
});

describe("the presets of a new group for tenants", () => {
    it("leads with Client, which backs up, downloads and restores what it sees and changes nothing", () => {
        expect(TENANT_GROUP_TEMPLATES[0]).toBe(CLIENT_TEMPLATE);
        expect(CLIENT_TEMPLATE.permissions).toEqual(expect.arrayContaining([P.SOURCES.VIEW, P.JOBS.EXECUTE, P.STORAGE.DOWNLOAD, P.STORAGE.RESTORE, P.HISTORY.READ]));
        expect(CLIENT_TEMPLATE.permissions.filter((permission) => permission.endsWith(":write") || permission.endsWith(":delete"))).toEqual([]);
    });

    it("names the others in the singular, like a tenant sees them, and keeps no setting of the instance", () => {
        expect(TENANT_GROUP_TEMPLATES.slice(1).map((entry) => entry.groupName)).toEqual(GROUP_TEMPLATES.map((entry) => entry.label));
        for (const preset of TENANT_GROUP_TEMPLATES) expect(presetRights(preset).some((permission) => PLATFORM_PERMISSIONS.has(permission))).toBe(false);
        const auditor = TENANT_GROUP_TEMPLATES.find((entry) => entry.id === "auditor")!;
        expect(auditor.permissions).toContain(P.SETTINGS.READ);
        expect(presetRights(auditor)).not.toContain(P.SETTINGS.READ);
    });
});

describe("what the editor of a new group for tenants starts with", () => {
    it("starts Custom with nothing and a preset with its permissions, named free of the others and of Admin", () => {
        expect(draftOf(null, { kind: "custom" }, ROOT, [])).toEqual({ name: "", held: [], scope: { allTenants: false, tenantIds: [] }, trimmed: false });
        expect(draftOf(null, { kind: "template", template: CLIENT_TEMPLATE }, ROOT, ["Client"])).toMatchObject({ name: "Client 2", held: CLIENT_TEMPLATE.permissions, trimmed: false });
        expect(draftOf(null, { kind: "template", template: { ...CLIENT_TEMPLATE, groupName: "admin" } }, ROOT, []).name).toBe("admin 2");
    });

    it("leaves out of a preset what the viewer may not give, and says so", () => {
        const draft = draftOf(null, { kind: "template", template: CLIENT_TEMPLATE }, NINA, []);
        expect(draft.held).toEqual(CLIENT_TEMPLATE.permissions.filter((permission) => ([P.JOBS.READ, P.HISTORY.READ, P.SOURCES.VIEW] as string[]).includes(permission)));
        expect(draft.trimmed).toBe(true);
    });

    it("copies a group for tenants with its tenants, without the ones beyond the viewer", () => {
        expect(draftOf(null, { kind: "copy", template: template({}) }, ROOT, ["Support"])).toEqual({
            name: "Support copy",
            held: [P.JOBS.READ, P.JOBS.EXECUTE, P.HISTORY.READ],
            scope: { allTenants: false, tenantIds: ["acme", "shop"] },
            trimmed: false,
        });
        expect(draftOf(null, { kind: "copy", template: template({}) }, NINA, ["Support"])).toEqual({
            name: "Support copy",
            held: [P.JOBS.READ, P.HISTORY.READ],
            scope: { allTenants: false, tenantIds: ["acme"] },
            trimmed: true,
        });
        expect(draftOf(null, { kind: "copy", template: template({ allTenants: true, tenantIds: [], permissions: [P.JOBS.READ] }) }, NINA, []).scope).toEqual({ allTenants: false, tenantIds: [] });
    });

    it("opens a group for tenants as it is", () => {
        expect(draftOf(template({}), { kind: "custom" }, NINA, [])).toEqual({
            name: "Support",
            held: [P.JOBS.READ, P.JOBS.EXECUTE, P.HISTORY.READ],
            scope: { allTenants: false, tenantIds: ["acme", "shop"] },
            trimmed: false,
        });
    });

    it("names what it started as in the head of the editor", () => {
        expect(startName(null)).toBe("Custom");
        expect(startName({ kind: "template", template: CLIENT_TEMPLATE })).toBe("Client");
        expect(startName({ kind: "copy", template: template({}) })).toBe("a copy of Support");
    });
});
