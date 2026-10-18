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
    templates: { find: vi.fn(), preview: vi.fn(), save: vi.fn(), remove: vi.fn() },
    shapeOf: vi.fn(),
    findAnywhere: vi.fn(),
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
    mocks.templates.save.mockResolvedValue({
        id: "tpl-client", name: "Client", permissions: [P.STORAGE.READ, P.STORAGE.RESTORE], allTenants: false, tenantIds: ["acme"], areas: [],
        report: report({ created: ["acme"], takenOver: ["shop"], groupIds: { acme: "g-acme", shop: "g-shop" } }),
    });
    mocks.templates.remove.mockResolvedValue({ name: "Client", report: report({ removed: ["acme"], kept: ["shop"], groupIds: { acme: "g-acme", shop: "g-shop" } }) });
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

    it("write the group into the log of the platform and what happened to it into the log of each tenant", async () => {
        mocks.viewer = ROOT;
        expect(await saveTenantGroupTemplate(null, values(), { clashes: { shop: "takeOver" } })).toEqual(expect.objectContaining({ success: true }));
        expect(mocks.templates.save).toHaveBeenCalledWith(null, expect.objectContaining({ name: "Client" }), { clashes: { shop: "takeOver" } });
        expect(mocks.audit).toHaveBeenCalledWith("root", "CREATE", "GROUP", expect.objectContaining({ name: "Client", forTenants: true, scope: "1 tenant" }), "tpl-client", { tenantId: "default" });
        expect(mocks.audit).toHaveBeenCalledWith("root", "CREATE", "GROUP", expect.objectContaining({ name: "Client", fromPlatform: true }), "g-acme", { tenantId: "acme" });
        expect(mocks.audit).toHaveBeenCalledWith("root", "UPDATE", "GROUP", expect.objectContaining({ change: "Taken over by the platform" }), "g-shop", { tenantId: "shop" });
    });

    it("pass the decision of each tenant on to the delete, and log it there", async () => {
        mocks.viewer = ROOT;
        const result = await deleteTenantGroupTemplate("tpl-client", { acme: { keep: false, moveTo: "g-viewer" }, shop: { keep: true } });
        expect(result).toEqual(expect.objectContaining({ success: true }));
        expect(mocks.templates.remove).toHaveBeenCalledWith("tpl-client", { acme: { keep: false, moveTo: "g-viewer" }, shop: { keep: true } });
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
            return { name: "Client", report: report({ removed: ["acme"], groupIds: { acme: "g-acme" } }) };
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
        expect(mocks.templates.remove).toHaveBeenCalledWith("tpl-client");
        expect(mocks.templates.remove).not.toHaveBeenCalledWith("tpl-vault");
        expect(mocks.audit).toHaveBeenCalledWith("nina", "DELETE", "GROUP", expect.objectContaining({ name: "Client", forTenants: true }), "tpl-client", { tenantId: "default" });
        expect(mocks.audit).toHaveBeenCalledWith("nina", "DELETE", "GROUP", expect.objectContaining({ change: "Taken back by the platform" }), "g-acme", { tenantId: "acme" });
    });
});
