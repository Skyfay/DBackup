/**
 * Adding an account to a tenant on the Tenants page: someone of a platform group adds only an
 * account they may see, like Add member offers them: the people of the tenants their platform
 * group reaches, also when they may see the accounts of the platform.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PERMISSIONS } from "@/lib/auth/permissions";

type Viewer = { id: string; isPlatformAdmin: boolean; tenantId: string | null; allTenants: boolean; permissions: string[] };

const mocks = vi.hoisted(() => ({
    viewer: null as unknown as Viewer,
    memberships: { setRole: vi.fn(), isPlatformAdmin: vi.fn(), roleOf: vi.fn() },
    platformGroups: { reaches: vi.fn(), peopleReached: vi.fn() },
}));

vi.mock("@/lib/auth/access-control", () => ({
    checkPermission: vi.fn(async () => mocks.viewer),
    checkPlatformAdmin: vi.fn(async () => mocks.viewer),
    hasPermissionWithContext: (viewer: Viewer, permission: string) => viewer.isPlatformAdmin || viewer.permissions.includes(permission),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ default: {} }));
vi.mock("@/services/tenant/tenant-service", () => ({ tenantService: { find: vi.fn(async (id: string) => ({ id, name: "Acme" })) } }));
vi.mock("@/services/user/group-service", () => ({ groupService: { find: vi.fn(async (id: string) => ({ id, name: "Operators", permissions: "[]", fullAccess: false })) } }));
vi.mock("@/services/tenant/membership-service", () => ({ membershipService: mocks.memberships }));
vi.mock("@/services/user/users-model", () => ({ getUsersModel: vi.fn() }));
vi.mock("@/services/user/platform-group-service", () => ({ platformGroupService: mocks.platformGroups }));
vi.mock("@/services/user/user-service", () => ({ userService: { permissionsIn: vi.fn(async () => [PERMISSIONS.USERS.READ, PERMISSIONS.USERS.WRITE]) } }));
vi.mock("@/services/audit-service", () => ({ auditService: { log: vi.fn() } }));

const { setTenantMember } = await import("@/app/actions/tenant/members");

/** Nina may manage the tenants, and her platform group reaches Acme only. */
const NINA: Viewer = { id: "nina", isPlatformAdmin: false, tenantId: "default", allTenants: false, permissions: [PERMISSIONS.PLATFORM.TENANTS_READ, PERMISSIONS.PLATFORM.TENANTS_WRITE] };

describe("adding an account to a tenant through a platform group", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.viewer = NINA;
        mocks.memberships.isPlatformAdmin.mockResolvedValue(false);
        mocks.memberships.roleOf.mockResolvedValue(null);
        mocks.memberships.setRole.mockResolvedValue(undefined);
        mocks.platformGroups.reaches.mockImplementation(async (_userId: string, tenantId: string) => tenantId === "acme");
        // The people of Acme, the only tenant her platform group reaches.
        mocks.platformGroups.peopleReached.mockResolvedValue(["tom"]);
    });

    it("never pulls an account of a tenant beyond her platform group into one she reaches", async () => {
        expect(await setTenantMember("acme", "carla-of-globex", "g-ops")).toEqual({ success: false, error: "The account no longer exists." });
        expect(mocks.memberships.setRole).not.toHaveBeenCalled();
    });

    it("adds an account of a tenant she reaches", async () => {
        expect(await setTenantMember("acme", "tom", "g-ops")).toEqual({ success: true });
        expect(mocks.memberships.setRole).toHaveBeenCalledWith("tom", "acme", "g-ops", { platformAdmin: false });
    });

    it("keeps the accounts of a tenant beyond her platform group out, also when she may see the accounts of the platform", async () => {
        mocks.viewer = { ...NINA, permissions: [...NINA.permissions, PERMISSIONS.PLATFORM.ACCOUNTS_READ, PERMISSIONS.PLATFORM.ACCOUNTS_WRITE] };

        expect(await setTenantMember("acme", "carla-of-globex", "g-ops")).toEqual({ success: false, error: "The account no longer exists." });
        expect(mocks.memberships.setRole).not.toHaveBeenCalled();
    });

    it("adds any account for a platform group of all tenants, whose people are everyone", async () => {
        mocks.viewer = { ...NINA, permissions: [...NINA.permissions, PERMISSIONS.PLATFORM.ACCOUNTS_READ] };
        mocks.platformGroups.peopleReached.mockResolvedValue(["tom", "carla-of-globex"]);

        expect(await setTenantMember("acme", "carla-of-globex", "g-ops")).toEqual({ success: true });
    });

    it("changes the group of someone who works in the tenant already", async () => {
        mocks.memberships.roleOf.mockResolvedValue({ id: "g-view", name: "Viewers", permissions: "[]", fullAccess: false });
        mocks.platformGroups.peopleReached.mockResolvedValue([]);

        expect(await setTenantMember("acme", "carla", "g-ops")).toEqual({ success: true });
    });
});
