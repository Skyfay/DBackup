import { beforeEach, describe, expect, it, vi } from "vitest";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { PermissionError, ValidationError } from "@/lib/logging/errors";

const ROOT = { id: "root", isPlatformAdmin: true, tenantId: null as string | null, allTenants: true, permissions: [] as string[] };

const mocks = vi.hoisted(() => ({
    viewer: null as unknown as { id: string; isPlatformAdmin: boolean; tenantId: string | null; allTenants: boolean; permissions: string[] },
    tenants: { find: vi.fn(), switchable: vi.fn() },
    groups: { find: vi.fn() },
    memberships: { setRole: vi.fn(), isPlatformAdmin: vi.fn(), roleOf: vi.fn(async (): Promise<unknown> => null) },
    platformGroups: { reaches: vi.fn(), peopleReached: vi.fn(async (): Promise<string[]> => []) },
    users: { permissionsIn: vi.fn() },
    audit: vi.fn(),
}));

// The real checks, reduced to the permissions of the viewer, which a platform admin passes.
vi.mock("@/lib/auth/access-control", () => ({
    checkPermission: vi.fn(async (permission: string) => {
        if (!mocks.viewer.isPlatformAdmin && !mocks.viewer.permissions.includes(permission)) throw new PermissionError(permission);
        return mocks.viewer;
    }),
    checkPlatformAdmin: vi.fn(async () => {
        if (!mocks.viewer.isPlatformAdmin) throw new PermissionError("platform admin");
        return mocks.viewer;
    }),
    hasPermissionWithContext: (viewer: { isPlatformAdmin: boolean; permissions: string[] }, permission: string) => viewer.isPlatformAdmin || viewer.permissions.includes(permission),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ default: {} }));
vi.mock("@/services/tenant/tenant-service", () => ({ tenantService: mocks.tenants }));
vi.mock("@/services/user/group-service", () => ({ groupService: mocks.groups }));
vi.mock("@/services/tenant/membership-service", () => ({ membershipService: mocks.memberships }));
vi.mock("@/services/user/users-model", () => ({ getUsersModel: vi.fn() }));
vi.mock("@/services/user/platform-group-service", () => ({ platformGroupService: mocks.platformGroups }));
vi.mock("@/services/user/user-service", () => ({ userService: mocks.users }));
vi.mock("@/services/audit-service", () => ({ auditService: { log: mocks.audit } }));

const { setTenantMember } = await import("@/app/actions/tenant/members");

const ACME = { id: "tenant-a", name: "Acme GmbH" };
const OPERATORS = { id: "g-ops", name: "Operators", permissions: "[]", fullAccess: false };

/**
 * The group of an account in each tenant, which the panel of a user changes in All tenants and the
 * Tenants page changes for one tenant. Only a platform admin does it, for any tenant they name.
 */
describe("giving an account a group in a named tenant", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.viewer = ROOT;
        mocks.memberships.isPlatformAdmin.mockResolvedValue(false);
        mocks.tenants.switchable.mockResolvedValue([ACME]);
        mocks.tenants.find.mockImplementation(async (id: string) => (id === ACME.id ? ACME : null));
        mocks.groups.find.mockImplementation(async (id: string) => (id === OPERATORS.id ? OPERATORS : null));
        mocks.memberships.setRole.mockResolvedValue(undefined);
    });

    it("gives the group in the tenant it names, though All tenants has none open, and logs it into that tenant", async () => {
        expect(await setTenantMember("tenant-a", "tom", "g-ops")).toEqual({ success: true });

        expect(mocks.memberships.setRole).toHaveBeenCalledWith("tom", "tenant-a", "g-ops", { platformAdmin: true });
        expect(mocks.audit).toHaveBeenCalledWith("root", "UPDATE", "USER", { change: "Tenant group set", tenant: "Acme GmbH", group: "Operators" }, "tom", { tenantId: "tenant-a" });
    });

    it("takes the account out of the tenant with no group, and says so in the log of the tenant", async () => {
        expect(await setTenantMember("tenant-a", "tom", null)).toEqual({ success: true });

        expect(mocks.memberships.setRole).toHaveBeenCalledWith("tom", "tenant-a", null, { platformAdmin: true });
        expect(mocks.audit).toHaveBeenCalledWith("root", "UPDATE", "USER", { change: "Removed from tenant", tenant: "Acme GmbH" }, "tom", { tenantId: "tenant-a" });
    });

    it("refuses anyone who may not manage the tenants before it reads anything, also someone who may only see them", async () => {
        mocks.viewer = { id: "lena", isPlatformAdmin: false, tenantId: "default", allTenants: false, permissions: [PERMISSIONS.USERS.WRITE, PERMISSIONS.PLATFORM.TENANTS_READ] };

        await expect(setTenantMember("tenant-a", "tom", "g-ops")).rejects.toBeInstanceOf(PermissionError);
        expect(mocks.tenants.find).not.toHaveBeenCalled();
        expect(mocks.memberships.setRole).not.toHaveBeenCalled();
    });

    it("refuses a tenant or a group that is gone", async () => {
        expect(await setTenantMember("tenant-gone", "tom", "g-ops")).toEqual({ success: false, error: "The tenant no longer exists." });
        expect(await setTenantMember("tenant-a", "tom", "g-gone")).toEqual({ success: false, error: "The group no longer exists." });
        expect(mocks.memberships.setRole).not.toHaveBeenCalled();
        expect(mocks.audit).not.toHaveBeenCalled();
    });

    it("lets the platform admin take themselves out of a tenant, since they manage every tenant anyway", async () => {
        expect(await setTenantMember("tenant-a", "root", null)).toEqual({ success: true });

        // The service skips the guard that keeps someone who manages the members for a platform admin.
        expect(mocks.memberships.setRole).toHaveBeenCalledWith("root", "tenant-a", null, { platformAdmin: true });
    });

    it("hands on a refusal of the service with its reason, and logs nothing", async () => {
        mocks.memberships.setRole.mockRejectedValue(new ValidationError("The group no longer exists."));

        expect(await setTenantMember("tenant-a", "tom", "g-ops")).toEqual({ success: false, error: "The group no longer exists." });
        expect(mocks.audit).not.toHaveBeenCalled();
    });

    it("turns away ids that are no ids", async () => {
        mocks.viewer = ROOT;
        expect(await setTenantMember("", "tom", "g-ops")).toEqual({ success: false, error: "Invalid request" });
        expect(await setTenantMember("tenant-a", "x".repeat(201), "g-ops")).toEqual({ success: false, error: "Invalid request" });
        expect(mocks.memberships.setRole).not.toHaveBeenCalled();
    });
});

/** Someone of a platform group that may change tenants, who works in the home tenant. */
const NINA = { id: "nina", isPlatformAdmin: false, tenantId: "default", allTenants: false, permissions: [PERMISSIONS.PLATFORM.TENANTS_READ, PERMISSIONS.PLATFORM.TENANTS_WRITE] };

describe("the members of a tenant, changed through a platform group", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.viewer = NINA;
        mocks.memberships.isPlatformAdmin.mockResolvedValue(false);
        mocks.memberships.setRole.mockResolvedValue(undefined);
        mocks.memberships.roleOf.mockResolvedValue(null);
        mocks.tenants.switchable.mockResolvedValue([ACME]);
        // The platform group of Nina reaches Acme, where it lets her manage users.
        mocks.platformGroups.reaches.mockImplementation(async (_userId: string, tenantId: string) => tenantId === ACME.id);
        mocks.users.permissionsIn.mockResolvedValue([PERMISSIONS.USERS.READ, PERMISSIONS.USERS.WRITE]);
        mocks.tenants.find.mockImplementation(async (id: string) => (id === ACME.id ? ACME : { id, name: "Other" }));
        mocks.groups.find.mockImplementation(async (id: string) => (id === OPERATORS.id ? OPERATORS : null));
    });

    it("gives a group in a tenant the platform group reaches, with the guard that keeps someone who manages the members", async () => {
        expect(await setTenantMember("tenant-a", "tom", "g-ops")).toEqual({ success: true });
        expect(mocks.memberships.setRole).toHaveBeenCalledWith("tom", "tenant-a", "g-ops", { platformAdmin: false });
    });

    it("never changes a tenant out of its reach, which reads as gone", async () => {
        expect(await setTenantMember("tenant-b", "tom", "g-ops")).toEqual({ success: false, error: "The tenant no longer exists." });
        expect(mocks.memberships.setRole).not.toHaveBeenCalled();
    });

    it("never gives or takes a group that may do more than she may in that tenant", async () => {
        const admins = { id: "g-admins", name: "Admin", permissions: "[]", fullAccess: true };
        mocks.groups.find.mockImplementation(async (id: string) => (id === admins.id ? admins : OPERATORS));
        expect(await setTenantMember("tenant-a", "tom", "g-admins")).toEqual(expect.objectContaining({ success: false }));

        mocks.memberships.roleOf.mockResolvedValue(admins);
        expect(await setTenantMember("tenant-a", "tom", null)).toEqual(expect.objectContaining({ success: false }));
        expect(mocks.memberships.setRole).not.toHaveBeenCalled();
    });

    it("never changes the own membership, nor that of a platform admin", async () => {
        expect(await setTenantMember("tenant-a", "nina", "g-ops")).toEqual({ success: false, error: "Another admin changes your own membership." });
        mocks.memberships.isPlatformAdmin.mockResolvedValue(true);
        expect(await setTenantMember("tenant-a", "root", null)).toEqual({ success: false, error: "Only a platform admin changes the memberships of a platform admin." });
        expect(mocks.memberships.setRole).not.toHaveBeenCalled();
        expect(mocks.audit).not.toHaveBeenCalled();
    });
});
