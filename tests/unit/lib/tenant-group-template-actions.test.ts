/**
 * The actions of the groups the platform makes for tenants: they need the right to manage the
 * accounts of the platform, nobody makes one that may do more in a tenant than their own platform
 * group gives there or that reaches a tenant it does not, nobody moves people into a group beyond
 * them, and both the log of the platform and the log of each tenant keep what happened.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { PermissionError } from "@/lib/logging/errors";
import type { PlatformGroupShape } from "@/lib/auth/platform-group-caps";

const P = PERMISSIONS;

/** Support of the MSP: manages the accounts, and in Acme and Shop sees and restores backups. */
const SUPPORT: PlatformGroupShape = {
    platformPermissions: [P.PLATFORM.ACCOUNTS_READ, P.PLATFORM.ACCOUNTS_WRITE],
    tenantPermissions: [P.STORAGE.READ, P.STORAGE.RESTORE, P.HISTORY.READ],
    allTenants: false,
    tenantIds: ["acme", "shop"],
};

type Viewer = { id: string; name: string; email: string; isPlatformAdmin: boolean; permissions: string[] };
const NINA: Viewer = { id: "nina", name: "Nina", email: "nina@example.com", isPlatformAdmin: false, permissions: [...SUPPORT.platformPermissions, ...SUPPORT.tenantPermissions] };
const ROOT: Viewer = { id: "root", name: "Manu", email: "manu@example.com", isPlatformAdmin: true, permissions: [] };

const mocks = vi.hoisted(() => ({
    viewer: null as unknown as Viewer,
    audit: vi.fn(),
    templates: {
        find: vi.fn(), preview: vi.fn(), save: vi.fn(), remove: vi.fn(), platformAdminLeaving: vi.fn(), memberLeaving: vi.fn(), memberChanging: vi.fn(), memberNamed: vi.fn(),
        membersLeaving: vi.fn(), groupsNamed: vi.fn(async () => []),
    },
    shapeOf: vi.fn(),
    findAnywhere: vi.fn(),
    membershipEndRefusal: vi.fn(),
}));

vi.mock("@/lib/auth/access-control", () => ({
    checkPermission: vi.fn(async (permission: string) => {
        if (!mocks.viewer.isPlatformAdmin && !mocks.viewer.permissions.includes(permission)) throw new PermissionError(permission);
        return mocks.viewer;
    }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ default: {} }));
vi.mock("@/services/audit-service", () => ({ auditService: { log: mocks.audit } }));
vi.mock("@/services/user/platform-group-service", () => ({ platformGroupService: { shapeOf: mocks.shapeOf } }));
vi.mock("@/services/user/group-service", () => ({ groupService: { findAnywhere: mocks.findAnywhere } }));
vi.mock("@/services/tenant/membership-end", () => ({ membershipEndRefusal: mocks.membershipEndRefusal }));
vi.mock("@/services/user/tenant-group-templates", () => ({
    tenantGroupTemplates: mocks.templates,
    templateRights: (ids: Iterable<string>) => [...ids].filter((id) => !id.startsWith("settings:")),
}));

const { bulkDeleteTenantGroupTemplates, previewTenantGroupTemplate, saveTenantGroupTemplate, deleteTenantGroupTemplate } = await import("@/app/actions/auth/tenant-group-template");

const values = (over: Partial<{ permissions: string[]; allTenants: boolean; tenantIds: string[] }> = {}) => ({
    name: "Client",
    permissions: [P.STORAGE.READ, P.STORAGE.RESTORE],
    allTenants: false,
    tenantIds: ["acme"],
    ...over,
});

const report = (over: Record<string, unknown> = {}) => ({ created: [], takenOver: [], leftOut: [], removed: [], kept: [], changed: [], groupIds: {}, ...over });

beforeEach(() => {
    vi.clearAllMocks();
    mocks.viewer = NINA;
    mocks.shapeOf.mockImplementation(async (id: string) => (id === "nina" ? { id: "pg-support", shape: SUPPORT } : null));
    mocks.templates.find.mockResolvedValue({ id: "tpl-client", name: "Client", permissions: [P.STORAGE.READ], allTenants: false, tenantIds: ["acme"] });
    mocks.templates.preview.mockResolvedValue({ clashes: [], leaving: [] });
    mocks.templates.platformAdminLeaving.mockResolvedValue(null);
    mocks.templates.memberLeaving.mockResolvedValue(null);
    mocks.templates.memberChanging.mockResolvedValue(null);
    mocks.templates.memberNamed.mockResolvedValue(null);
    mocks.templates.membersLeaving.mockResolvedValue([]);
    mocks.membershipEndRefusal.mockResolvedValue(null);
    mocks.templates.save.mockResolvedValue({
        id: "tpl-client", name: "Client", permissions: [P.STORAGE.READ, P.STORAGE.RESTORE], allTenants: false, tenantIds: ["acme"], areas: [],
        report: report({ created: ["acme"], takenOver: ["shop"], groupIds: { acme: "g-acme", shop: "g-shop" } }), ssoProviders: [],
    });
    mocks.templates.remove.mockResolvedValue({ name: "Client", report: report({ removed: ["acme"], kept: ["shop"], groupIds: { acme: "g-acme", shop: "g-shop" } }), ssoProviders: [] });
    mocks.findAnywhere.mockImplementation(async (id: string) => ({
        "g-viewer": { id, name: "Viewer", permissions: JSON.stringify([P.STORAGE.READ]), fullAccess: false, tenantId: "acme" },
        "g-admin": { id, name: "Admin", permissions: "[]", fullAccess: true, tenantId: "acme" },
        "g-ops": { id, name: "Operators", permissions: JSON.stringify([P.STORAGE.READ, P.JOBS.EXECUTE]), fullAccess: false, tenantId: "acme" },
    } as Record<string, unknown>)[id] ?? null);
});

describe("groups the platform makes for tenants", () => {
    it("need the right to manage the accounts of the platform before anything is read", async () => {
        mocks.viewer = { ...NINA, permissions: [P.PLATFORM.ACCOUNTS_READ, P.GROUPS.WRITE] };
        await expect(previewTenantGroupTemplate(null, values())).rejects.toBeInstanceOf(PermissionError);
        await expect(saveTenantGroupTemplate(null, values())).rejects.toBeInstanceOf(PermissionError);
        await expect(deleteTenantGroupTemplate("tpl-client")).rejects.toBeInstanceOf(PermissionError);
        for (const call of Object.values(mocks.templates)) expect(call).not.toHaveBeenCalled();
    });

    it("give nobody more in a tenant than their own platform group gives there", async () => {
        const result = await saveTenantGroupTemplate(null, values({ permissions: [P.STORAGE.READ, P.STORAGE.DELETE] }));
        expect(result).toEqual({ success: false, error: expect.stringMatching(/group for tenants can only get/) });
        expect(mocks.templates.save).not.toHaveBeenCalled();
    });

    it("reach no tenant and not every tenant beyond the scope of their own platform group", async () => {
        expect(await saveTenantGroupTemplate(null, values({ tenantIds: ["acme", "globex"] }))).toEqual({ success: false, error: expect.any(String) });
        expect(await saveTenantGroupTemplate(null, values({ allTenants: true, tenantIds: [] }))).toEqual({ success: false, error: expect.any(String) });
        expect(await previewTenantGroupTemplate(null, values({ allTenants: true, tenantIds: [] }))).toEqual({ success: false, error: expect.any(String) });
        expect(mocks.templates.save).not.toHaveBeenCalled();
    });

    it("let nobody change one that may do more than they may", async () => {
        mocks.templates.find.mockResolvedValue({ id: "tpl-client", name: "Client", permissions: [P.VAULT.WRITE], allTenants: false, tenantIds: ["acme"] });
        expect(await saveTenantGroupTemplate("tpl-client", values())).toEqual({ success: false, error: expect.stringMatching(/may do more than you may/) });
        expect(await deleteTenantGroupTemplate("tpl-client")).toEqual({ success: false, error: expect.stringMatching(/may do more than you may/) });
    });

    it("show nobody the tenants, people and groups of one that reaches beyond them, even with a change inside their reach", async () => {
        // Client reaches Globex too, which Nina's platform group does not. Her change keeps to Acme.
        mocks.templates.find.mockResolvedValue({ id: "tpl-client", name: "Client", permissions: [P.STORAGE.READ], allTenants: false, tenantIds: ["acme", "globex"] });

        expect(await previewTenantGroupTemplate("tpl-client", values())).toEqual({ success: false, error: expect.stringMatching(/may do more than you may/) });
        expect(mocks.templates.preview).not.toHaveBeenCalled();

        // A platform admin sees it.
        mocks.viewer = ROOT;
        expect(await previewTenantGroupTemplate("tpl-client", values())).toEqual({ success: true, data: { clashes: [], leaving: [] } });
    });

    it("preview a change of one within their reach, and say when it is gone", async () => {
        expect(await previewTenantGroupTemplate("tpl-client", values())).toEqual({ success: true, data: { clashes: [], leaving: [] } });

        mocks.templates.find.mockResolvedValue(null);
        expect(await previewTenantGroupTemplate("tpl-gone", values())).toEqual({ success: false, error: "The group for tenants no longer exists." });
    });

    it("move nobody into a group that may do more than the viewer, nor into the one with every permission", async () => {
        const moved = (moveTo: string) => saveTenantGroupTemplate("tpl-client", values({ tenantIds: [] }), { leaving: { acme: { keep: false, moveTo } } });
        expect(await moved("g-ops")).toEqual({ success: false, error: "Operators may do more than you may, so you cannot move anyone into it." });
        expect(await moved("g-admin")).toEqual({ success: false, error: "Admin may do more than you may, so you cannot move anyone into it." });
        expect(await moved("g-viewer")).toEqual(expect.objectContaining({ success: true }));
    });

    it("name no group of a tenant beyond the group for tenants or the viewer to move into, nor one of another tenant", async () => {
        // Globex is beyond Nina's platform group, and its group of every permission must stay unnamed.
        mocks.findAnywhere.mockImplementation(async (id: string) => (id === "g-globex-admin" ? { id, name: "Globex admins", permissions: "[]", fullAccess: true, tenantId: "globex" } : null));
        const gone = { success: false, error: "The group for its members is not one of their tenant." };

        expect(await saveTenantGroupTemplate("tpl-client", values({ tenantIds: [] }), { leaving: { globex: { keep: false, moveTo: "g-globex-admin" } } })).toEqual(gone);
        expect(await deleteTenantGroupTemplate("tpl-client", { globex: { keep: false, moveTo: "g-globex-admin" } })).toEqual(gone);
        // Named for Acme, which the group for tenants leaves, the group of Globex is still none of Acme.
        expect(await saveTenantGroupTemplate("tpl-client", values({ tenantIds: [] }), { leaving: { acme: { keep: false, moveTo: "g-globex-admin" } } })).toEqual(gone);
        expect(mocks.findAnywhere).toHaveBeenCalledTimes(1);
        expect(mocks.templates.save).not.toHaveBeenCalled();
        expect(mocks.templates.remove).not.toHaveBeenCalled();
    });

    it("end or move the group of a platform admin in a tenant it leaves only for a platform admin", async () => {
        // A platform admin is in Client of Acme, which the change and the delete take away there.
        mocks.templates.platformAdminLeaving.mockImplementation(async (_id: string, _reach: unknown, leaving: Record<string, { keep: boolean }> = {}) => (leaving.acme?.keep ? null : { tenantId: "acme", tenantName: "Acme" }));
        const refusal = "A platform admin is in Client of Acme, so only a platform admin takes it away there. Keep it in Acme.";

        expect(await saveTenantGroupTemplate("tpl-client", values({ tenantIds: [] }), { leaving: { acme: { keep: false, moveTo: "g-viewer" } } })).toEqual({ success: false, error: refusal });
        expect(mocks.templates.platformAdminLeaving).toHaveBeenCalledWith("tpl-client", expect.objectContaining({ tenantIds: [] }), { acme: { keep: false, moveTo: "g-viewer" } });
        expect(await deleteTenantGroupTemplate("tpl-client", { acme: { keep: false, moveTo: null } })).toEqual({ success: false, error: refusal });
        expect(await bulkDeleteTenantGroupTemplates(["tpl-client"])).toEqual({ success: true, data: { succeeded: [], failed: [{ id: "tpl-client", name: "Client", error: refusal }] } });
        expect(mocks.templates.save).not.toHaveBeenCalled();
        expect(mocks.templates.remove).not.toHaveBeenCalled();

        // Kept as the tenant's own, the membership stays, and a platform admin goes on.
        expect(await deleteTenantGroupTemplate("tpl-client", { acme: { keep: true } })).toEqual(expect.objectContaining({ success: true }));
        mocks.viewer = ROOT;
        expect(await saveTenantGroupTemplate("tpl-client", values({ tenantIds: [] }), { leaving: { acme: { keep: false, moveTo: null } } })).toEqual(expect.objectContaining({ success: true }));
    });

    it("never move or end the viewer's own membership in a tenant it leaves, also for a platform admin", async () => {
        // Nina is in Client of Acme herself, which the change and the delete take away there.
        mocks.templates.memberLeaving.mockImplementation(async (_id: string, userId: string, _reach: unknown, leaving: Record<string, { keep: boolean }> = {}) =>
            (userId === mocks.viewer.id && !leaving.acme?.keep ? { tenantId: "acme", tenantName: "Acme" } : null));
        const refusal = "You are in Client of Acme, so you cannot move it or take it away there. Keep it in Acme, or let someone else do it.";

        expect(await saveTenantGroupTemplate("tpl-client", values({ tenantIds: [] }), { leaving: { acme: { keep: false, moveTo: "g-viewer" } } })).toEqual({ success: false, error: refusal });
        expect(mocks.templates.memberLeaving).toHaveBeenCalledWith("tpl-client", "nina", expect.objectContaining({ tenantIds: [] }), { acme: { keep: false, moveTo: "g-viewer" } });
        expect(await deleteTenantGroupTemplate("tpl-client", { acme: { keep: false, moveTo: null } })).toEqual({ success: false, error: refusal });
        expect(await bulkDeleteTenantGroupTemplates(["tpl-client"])).toEqual({ success: true, data: { succeeded: [], failed: [{ id: "tpl-client", name: "Client", error: refusal }] } });
        mocks.viewer = ROOT;
        expect(await deleteTenantGroupTemplate("tpl-client", { acme: { keep: false, moveTo: null } })).toEqual({ success: false, error: refusal });
        expect(mocks.templates.save).not.toHaveBeenCalled();
        expect(mocks.templates.remove).not.toHaveBeenCalled();

        // Kept as the tenant's own, the membership stays.
        mocks.viewer = NINA;
        expect(await deleteTenantGroupTemplate("tpl-client", { acme: { keep: true } })).toEqual(expect.objectContaining({ success: true }));
    });

    it("never change what the viewer's own group in a tenant it keeps may do, unless a platform admin saves it", async () => {
        // Nina is in Client of Acme herself, and the save would let it restore backups there.
        mocks.templates.memberChanging.mockImplementation(async (_id: string, userId: string) => (userId === "nina" ? { tenantId: "acme", tenantName: "Acme" } : null));

        expect(await saveTenantGroupTemplate("tpl-client", values())).toEqual({ success: false, error: "You are in Client of Acme, so you cannot change what it may do. Let someone else do it." });
        expect(mocks.templates.memberChanging).toHaveBeenCalledWith("tpl-client", "nina", expect.objectContaining({ permissions: [P.STORAGE.READ, P.STORAGE.RESTORE], tenantIds: ["acme"] }));
        expect(mocks.templates.save).not.toHaveBeenCalled();

        mocks.viewer = ROOT;
        expect(await saveTenantGroupTemplate("tpl-client", values())).toEqual(expect.objectContaining({ success: true }));
    });

    it("never take over a group of a tenant the viewer holds, unless a platform admin saves it", async () => {
        mocks.templates.memberNamed.mockImplementation(async (_id: string | null, _name: string, tenantIds: string[], userId: string) =>
            (userId === "nina" && tenantIds.includes("shop") ? { tenantId: "shop", tenantName: "Shop", name: "Client" } : null));

        expect(await saveTenantGroupTemplate(null, values({ tenantIds: ["acme", "shop"] }), { clashes: { shop: "takeOver" } }))
            .toEqual({ success: false, error: "You are in Client of Shop, so you cannot take it over. Leave Shop out, or let someone else do it." });
        expect(mocks.templates.memberNamed).toHaveBeenCalledWith(null, "Client", ["shop"], "nina");
        expect(mocks.templates.save).not.toHaveBeenCalled();

        // Left out, the group stays the tenant's own.
        expect(await saveTenantGroupTemplate(null, values({ tenantIds: ["acme", "shop"] }), { clashes: { shop: "leaveOut" } })).toEqual(expect.objectContaining({ success: true }));
        mocks.viewer = ROOT;
        expect(await saveTenantGroupTemplate(null, values({ tenantIds: ["acme", "shop"] }), { clashes: { shop: "takeOver" } })).toEqual(expect.objectContaining({ success: true }));
    });

    it("take nobody out of a tenant so that the account works afterwards only where the viewer manages the users", async () => {
        // Sam is in Client of Acme and in another tenant where Nina manages the users. A tenant left with no group for its members ends his membership there.
        mocks.templates.membersLeaving.mockImplementation(async (_id: string, _reach: unknown, leaving: Record<string, { keep: boolean; moveTo?: string | null }> = {}) =>
            (leaving.acme?.keep ? [] : [{ tenantId: "acme", tenantName: "Acme", userIds: ["sam"], ends: !leaving.acme?.moveTo }]));
        mocks.membershipEndRefusal.mockImplementation(async (_caller: unknown, userId: string, tenantId: string) => (userId === "sam" && tenantId === "acme" ? "hands over" : null));
        const refusal = "One of the members of Client in Acme would afterwards work only in tenants where you manage the users. Keep it in Acme or pick a group there for its members, or let a platform admin do it.";

        expect(await saveTenantGroupTemplate("tpl-client", values({ tenantIds: [] }), { leaving: { acme: { keep: false, moveTo: null } } })).toEqual({ success: false, error: refusal });
        expect(mocks.templates.membersLeaving).toHaveBeenCalledWith("tpl-client", expect.objectContaining({ tenantIds: [] }), { acme: { keep: false, moveTo: null } });
        expect(mocks.membershipEndRefusal).toHaveBeenCalledWith(expect.objectContaining({ id: "nina" }), "sam", "acme");
        expect(await deleteTenantGroupTemplate("tpl-client", { acme: { keep: false, moveTo: null } })).toEqual({ success: false, error: refusal });
        expect(mocks.templates.membersLeaving).toHaveBeenLastCalledWith("tpl-client", null, { acme: { keep: false, moveTo: null } });
        expect(mocks.templates.save).not.toHaveBeenCalled();
        expect(mocks.templates.remove).not.toHaveBeenCalled();

        // Moved to another group there, or kept as the tenant's own, the membership stays.
        expect(await saveTenantGroupTemplate("tpl-client", values({ tenantIds: [] }), { leaving: { acme: { keep: false, moveTo: "g-viewer" } } })).toEqual(expect.objectContaining({ success: true }));
        expect(await deleteTenantGroupTemplate("tpl-client", { acme: { keep: true } })).toEqual(expect.objectContaining({ success: true }));

        // A platform admin may change the account anyway.
        mocks.viewer = ROOT;
        mocks.membershipEndRefusal.mockClear();
        expect(await deleteTenantGroupTemplate("tpl-client", { acme: { keep: false, moveTo: null } })).toEqual(expect.objectContaining({ success: true }));
        expect(mocks.membershipEndRefusal).not.toHaveBeenCalled();
    });

    it("hand the members whose end they checked to the service, so someone added since stops the change", async () => {
        mocks.templates.membersLeaving.mockResolvedValue([{ tenantId: "acme", tenantName: "Acme", userIds: ["sam"], ends: true }]);
        const { ConflictError } = await import("@/lib/logging/errors");
        mocks.templates.remove.mockRejectedValueOnce(new ConflictError("The members of this group changed meanwhile, try again."));

        expect(await deleteTenantGroupTemplate("tpl-client", { acme: { keep: false, moveTo: null } }))
            .toEqual({ success: false, error: "The members of this group changed meanwhile, try again." });
        expect(mocks.templates.remove).toHaveBeenCalledWith("tpl-client", { acme: { keep: false, moveTo: null } }, { platformAdmin: false, checkedEnds: { acme: ["sam"] } });

        expect(await saveTenantGroupTemplate("tpl-client", values({ tenantIds: [] }), { leaving: { acme: { keep: false, moveTo: null } } })).toEqual(expect.objectContaining({ success: true }));
        expect(mocks.templates.save).toHaveBeenCalledWith("tpl-client", expect.anything(), { leaving: { acme: { keep: false, moveTo: null } } }, { platformAdmin: false, checkedEnds: { acme: ["sam"] } });
    });

    it("hand the members of a group they move to the service too, so a platform admin added since is never moved", async () => {
        mocks.templates.membersLeaving.mockResolvedValue([{ tenantId: "acme", tenantName: "Acme", userIds: ["sam"], ends: false }]);
        const moved = { acme: { keep: false as const, moveTo: "g-viewer" } };

        expect(await deleteTenantGroupTemplate("tpl-client", moved)).toEqual(expect.objectContaining({ success: true }));
        expect(mocks.templates.remove).toHaveBeenCalledWith("tpl-client", moved, { platformAdmin: false, checkedEnds: { acme: ["sam"] } });
        expect(await saveTenantGroupTemplate("tpl-client", values({ tenantIds: [] }), { leaving: moved })).toEqual(expect.objectContaining({ success: true }));
        expect(mocks.templates.save).toHaveBeenCalledWith("tpl-client", expect.anything(), { leaving: moved }, { platformAdmin: false, checkedEnds: { acme: ["sam"] } });
        // A move keeps the membership, so it asks nothing of an end.
        expect(mocks.membershipEndRefusal).not.toHaveBeenCalled();
    });

    it("let the service keep someone who manages the members of each tenant, unless a platform admin acts", async () => {
        const { ValidationError } = await import("@/lib/logging/errors");
        mocks.templates.remove.mockRejectedValue(new ValidationError("Nobody would manage the members of Acme any more. Give someone there that right first, or keep it in this group."));

        expect(await deleteTenantGroupTemplate("tpl-client", { acme: { keep: false, moveTo: null } }))
            .toEqual({ success: false, error: "Nobody would manage the members of Acme any more. Give someone there that right first, or keep it in this group." });
        expect(mocks.templates.remove).toHaveBeenCalledWith("tpl-client", { acme: { keep: false, moveTo: null } }, { platformAdmin: false, checkedEnds: {} });
        expect(await saveTenantGroupTemplate("tpl-client", values())).toEqual(expect.objectContaining({ success: true }));
        expect(mocks.templates.save).toHaveBeenCalledWith("tpl-client", expect.anything(), {}, { platformAdmin: false, checkedEnds: {} });
    });

    it("write the sign-in providers a removed group changed into the log of the platform", async () => {
        mocks.viewer = ROOT;
        const okta = { id: "sso-okta", name: "Okta", tenantId: "acme", before: { group: "Client", allowProvisioning: true }, after: { group: null, allowProvisioning: false } };
        mocks.templates.remove.mockResolvedValue({ name: "Client", report: report({ removed: ["acme"], groupIds: { acme: "g-acme" } }), ssoProviders: [okta] });
        mocks.templates.save.mockResolvedValue({
            id: "tpl-client", name: "Client", permissions: [P.STORAGE.READ], allTenants: false, tenantIds: [], areas: [],
            report: report({ removed: ["acme"], groupIds: { acme: "g-acme" } }), ssoProviders: [{ ...okta, id: "sso-entra", name: "Entra" }],
        });

        expect(await deleteTenantGroupTemplate("tpl-client", { acme: { keep: false, moveTo: null } })).toEqual(expect.objectContaining({ success: true }));
        expect(mocks.audit).toHaveBeenCalledWith("root", "UPDATE", "SSO_PROVIDER", { name: "Okta", changes: expect.arrayContaining([expect.anything()]), tenantId: "acme" }, "sso-okta", { tenantId: "default" });

        expect(await saveTenantGroupTemplate("tpl-client", values({ tenantIds: [] }), { leaving: { acme: { keep: false, moveTo: null } } })).toEqual(expect.objectContaining({ success: true }));
        expect(mocks.audit).toHaveBeenCalledWith("root", "UPDATE", "SSO_PROVIDER", { name: "Entra", changes: expect.arrayContaining([expect.anything()]), tenantId: "acme" }, "sso-entra", { tenantId: "default" });

        // The providers stay out of what the browser gets.
        expect(await deleteTenantGroupTemplate("tpl-client", { acme: { keep: false, moveTo: null } })).toEqual({ success: true, data: expect.not.objectContaining({ ssoProviders: expect.anything() }) });
    });

    it("write the group into the log of the platform and what happened to it into the log of each tenant", async () => {
        mocks.viewer = ROOT;
        expect(await saveTenantGroupTemplate(null, values(), { clashes: { shop: "takeOver" } })).toEqual(expect.objectContaining({ success: true }));
        expect(mocks.templates.save).toHaveBeenCalledWith(null, expect.objectContaining({ name: "Client" }), { clashes: { shop: "takeOver" } }, { platformAdmin: true });
        expect(mocks.audit).toHaveBeenCalledWith("root", "CREATE", "GROUP", expect.objectContaining({ name: "Client", forTenants: true, scope: "1 tenant" }), "tpl-client", { tenantId: "default" });
        expect(mocks.audit).toHaveBeenCalledWith("root", "CREATE", "GROUP", expect.objectContaining({ name: "Client", fromPlatform: true }), "g-acme", { tenantId: "acme" });
        expect(mocks.audit).toHaveBeenCalledWith("root", "UPDATE", "GROUP", expect.objectContaining({ change: "Taken over by the platform" }), "g-shop", { tenantId: "shop" });
    });

    it("pass the decision of each tenant on to the delete, and log it there", async () => {
        mocks.viewer = ROOT;
        const result = await deleteTenantGroupTemplate("tpl-client", { acme: { keep: false, moveTo: "g-viewer" }, shop: { keep: true } });
        expect(result).toEqual(expect.objectContaining({ success: true }));
        expect(mocks.templates.remove).toHaveBeenCalledWith("tpl-client", { acme: { keep: false, moveTo: "g-viewer" }, shop: { keep: true } }, { platformAdmin: true });
        expect(mocks.audit).toHaveBeenCalledWith("root", "DELETE", "GROUP", expect.objectContaining({ change: "Taken back by the platform" }), "g-acme", { tenantId: "acme" });
        expect(mocks.audit).toHaveBeenCalledWith("root", "UPDATE", "GROUP", expect.objectContaining({ change: "Left to the tenant by the platform" }), "g-shop", { tenantId: "shop" });
    });
});

describe("deleting several groups for tenants at once", () => {
    it("needs the right to manage the accounts of the platform", async () => {
        mocks.viewer = { ...NINA, permissions: [P.PLATFORM.ACCOUNTS_READ] };
        await expect(bulkDeleteTenantGroupTemplates(["tpl-client"])).rejects.toThrow(PermissionError);
        expect(mocks.templates.remove).not.toHaveBeenCalled();
    });

    it("deletes the ones nobody holds and keeps, with why, one beyond the viewer and one people hold", async () => {
        mocks.templates.find.mockImplementation(async (id: string) => ({
            "tpl-client": { id, name: "Client", permissions: [P.STORAGE.READ], allTenants: false, tenantIds: ["acme"] },
            "tpl-vault": { id, name: "Vault", permissions: [P.VAULT.WRITE], allTenants: false, tenantIds: ["acme"] },
            "tpl-held": { id, name: "Held", permissions: [P.STORAGE.READ], allTenants: false, tenantIds: ["acme"] },
        } as Record<string, unknown>)[id] ?? null);
        mocks.templates.remove.mockImplementation(async (id: string) => {
            if (id === "tpl-held") {
                const { ValidationError } = await import("@/lib/logging/errors");
                throw new ValidationError("Decide what happens to Held in Acme, people hold it there.");
            }
            return { name: "Client", report: report({ removed: ["acme"], groupIds: { acme: "g-acme" } }), ssoProviders: [] };
        });

        const result = await bulkDeleteTenantGroupTemplates(["tpl-client", "tpl-vault", "tpl-held", "tpl-gone"]);

        expect(result).toEqual({
            success: true,
            data: {
                succeeded: ["tpl-client"],
                failed: [
                    { id: "tpl-vault", name: "Vault", error: expect.stringMatching(/may do more than you may/) },
                    { id: "tpl-held", name: "Held", error: "Decide what happens to Held in Acme, people hold it there." },
                    { id: "tpl-gone", name: undefined, error: "The group for tenants no longer exists." },
                ],
            },
        });
        expect(mocks.templates.remove).toHaveBeenCalledWith("tpl-client", {}, { platformAdmin: false });
        expect(mocks.templates.remove).not.toHaveBeenCalledWith("tpl-vault", expect.anything(), expect.anything());
        expect(mocks.audit).toHaveBeenCalledWith("nina", "DELETE", "GROUP", expect.objectContaining({ name: "Client", forTenants: true }), "tpl-client", { tenantId: "default" });
        expect(mocks.audit).toHaveBeenCalledWith("nina", "DELETE", "GROUP", expect.objectContaining({ change: "Taken back by the platform" }), "g-acme", { tenantId: "acme" });
    });
});
