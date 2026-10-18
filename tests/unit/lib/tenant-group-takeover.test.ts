/**
 * Taking over the own group of a tenant through a group for tenants: the take-over sets what its
 * members may do and hands the group to the platform, so nobody takes over a group that may do
 * more than their own platform group gives in the tenants. The preview says so first, the save
 * refuses it either way.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PERMISSIONS } from "@/lib/auth/permissions";
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

/** The own Client of Shop lets its members run jobs, which Support does not give. */
const SHOP_CLIENT = { id: "g-shop-client", tenantId: "shop", tenantName: "Shop", name: "Client", permissions: [P.STORAGE.READ, P.JOBS.EXECUTE], fullAccess: false };
/** The own Client of Acme only reads backups. */
const ACME_CLIENT = { id: "g-acme-client", tenantId: "acme", tenantName: "Acme", name: "Client", permissions: [P.STORAGE.READ], fullAccess: false };

const mocks = vi.hoisted(() => ({
    viewer: null as unknown as Viewer,
    templates: { find: vi.fn(), preview: vi.fn(), save: vi.fn(), remove: vi.fn(), groupsNamed: vi.fn() },
}));

vi.mock("@/lib/auth/access-control", () => ({ checkPermission: vi.fn(async () => mocks.viewer) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ default: {} }));
vi.mock("@/services/audit-service", () => ({ auditService: { log: vi.fn() } }));
vi.mock("@/services/user/platform-group-service", () => ({ platformGroupService: { shapeOf: vi.fn(async (id: string) => (id === "nina" ? { id: "pg-support", shape: SUPPORT } : null)) } }));
vi.mock("@/services/user/group-service", () => ({ groupService: { findAnywhere: vi.fn() } }));
vi.mock("@/services/user/tenant-group-templates", () => ({
    tenantGroupTemplates: mocks.templates,
    templateRights: (ids: Iterable<string>) => [...ids].filter((id) => !id.startsWith("settings:")),
}));

const { previewTenantGroupTemplate, saveTenantGroupTemplate } = await import("@/app/actions/auth/tenant-group-template");

const values = { name: "Client", permissions: [P.STORAGE.READ], allTenants: false, tenantIds: ["acme", "shop"] };
const clash = (group: typeof SHOP_CLIENT) => ({ tenantId: group.tenantId, tenantName: group.tenantName, groupId: group.id, fullAccess: false, members: [], added: [], removed: [] });
const report = { created: [], takenOver: [], leftOut: [], removed: [], kept: [], changed: [], groupIds: {} };

beforeEach(() => {
    vi.clearAllMocks();
    mocks.viewer = NINA;
    mocks.templates.groupsNamed.mockImplementation(async (_name: string, tenantIds: string[]) => [ACME_CLIENT, SHOP_CLIENT].filter((group) => tenantIds.includes(group.tenantId)));
    mocks.templates.preview.mockResolvedValue({ clashes: [clash(ACME_CLIENT), clash(SHOP_CLIENT)], leaving: [] });
    mocks.templates.save.mockResolvedValue({ id: "tpl-client", name: "Client", permissions: [P.STORAGE.READ], allTenants: false, tenantIds: ["acme", "shop"], areas: [], report });
});

describe("taking over the own group of a tenant", () => {
    it("is refused for a group that may do more than the viewer, and nothing is saved", async () => {
        const result = await saveTenantGroupTemplate(null, values, { clashes: { acme: "takeOver", shop: "takeOver" } });

        expect(result).toEqual({ success: false, error: "Client of Shop may do more than you may, so you cannot take it over. Leave Shop out." });
        expect(mocks.templates.groupsNamed).toHaveBeenCalledWith("Client", ["acme", "shop"]);
        expect(mocks.templates.save).not.toHaveBeenCalled();
    });

    it("goes through for a group within the viewer's rights, with the other tenant left out", async () => {
        const result = await saveTenantGroupTemplate(null, values, { clashes: { acme: "takeOver", shop: "leaveOut" } });

        expect(result).toEqual(expect.objectContaining({ success: true }));
        expect(mocks.templates.groupsNamed).toHaveBeenCalledWith("Client", ["acme"]);
        expect(mocks.templates.save).toHaveBeenCalled();
    });

    it("lets a platform admin take over any group a tenant has", async () => {
        mocks.viewer = ROOT;

        expect(await saveTenantGroupTemplate(null, values, { clashes: { acme: "takeOver", shop: "takeOver" } })).toEqual(expect.objectContaining({ success: true }));
        expect(mocks.templates.groupsNamed).not.toHaveBeenCalled();
    });

    it("marks such a group in the preview, so the dialog offers only to leave its tenant out", async () => {
        const result = await previewTenantGroupTemplate(null, values);

        expect(result).toEqual({
            success: true,
            data: { clashes: [clash(ACME_CLIENT), { ...clash(SHOP_CLIENT), beyondYou: true }], leaving: [] },
        });
    });
});
