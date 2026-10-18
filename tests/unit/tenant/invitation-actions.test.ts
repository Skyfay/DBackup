/**
 * The invitation links of a tenant are made, listed and taken back in that tenant. All tenants only
 * reads, so it says so instead of a bare refusal, and touches no link.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PERMISSIONS } from "@/lib/auth/permissions";

const mocks = vi.hoisted(() => ({
    viewer: null as unknown as { id: string; name: string; isPlatformAdmin: boolean; tenantId: string | null; allTenants: boolean; permissions: string[] },
    invitations: { create: vi.fn(), list: vi.fn(), revoke: vi.fn() },
    audit: vi.fn(),
}));

vi.mock("@/lib/auth/access-control", async (importOriginal) => ({
    // The real refusal of All tenants.
    tenantRefusal: (await importOriginal<typeof import("@/lib/auth/access-control")>()).tenantRefusal,
    checkPermission: vi.fn(async () => mocks.viewer),
    getViewer: vi.fn(async () => mocks.viewer),
    currentSessionId: vi.fn(async () => null),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ default: {} }));
vi.mock("@/services/audit-service", () => ({ auditService: { log: mocks.audit } }));
vi.mock("@/services/tenant/invitation-service", () => ({ INVITATION_MAX_DAYS: 30, invitationService: mocks.invitations }));
vi.mock("@/services/tenant/tenant-service", () => ({ tenantService: { setActive: vi.fn() } }));
vi.mock("@/services/user/group-service", () => ({ groupService: { find: vi.fn(async () => ({ id: "g-ops", name: "Operators", permissions: "[]", fullAccess: false })) } }));

const { createInvitation, listInvitations, revokeInvitation } = await import("@/app/actions/tenant/invitation");

const ALL_TENANTS_REFUSAL = "All tenants only reads. Open the tenant of the record to change it.";
const ROOT = { id: "root", name: "Manu", isPlatformAdmin: true, tenantId: null, allTenants: true, permissions: [PERMISSIONS.USERS.READ, PERMISSIONS.USERS.WRITE] };
const LENA = { id: "lena", name: "Lena", isPlatformAdmin: false, tenantId: "acme", allTenants: false, permissions: [PERMISSIONS.USERS.READ, PERMISSIONS.USERS.WRITE] };

describe("the invitation links of a tenant", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.invitations.list.mockResolvedValue([]);
        mocks.invitations.revoke.mockResolvedValue({ groupName: "Operators", note: null });
        mocks.invitations.create.mockResolvedValue({ id: "inv-1", token: "t".repeat(32), expiresAt: new Date() });
    });

    it("say in All tenants that it only reads, and touch no link", async () => {
        mocks.viewer = ROOT;

        expect(await createInvitation({ groupId: "g-ops", days: 7 })).toEqual({ success: false, error: ALL_TENANTS_REFUSAL });
        expect(await listInvitations()).toEqual({ success: false, error: ALL_TENANTS_REFUSAL });
        expect(await revokeInvitation("inv-1")).toEqual({ success: false, error: ALL_TENANTS_REFUSAL });
        for (const call of [...Object.values(mocks.invitations), mocks.audit]) expect(call).not.toHaveBeenCalled();
    });

    it("are made, listed and taken back in the tenant of the viewer", async () => {
        mocks.viewer = LENA;

        expect(await createInvitation({ groupId: "g-ops", days: 7 })).toMatchObject({ success: true });
        expect(mocks.invitations.create).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "acme", groupId: "g-ops" }));
        expect(await listInvitations()).toEqual({ success: true, data: [] });
        expect(mocks.invitations.list).toHaveBeenCalledWith("acme");
        expect(await revokeInvitation("inv-1")).toEqual({ success: true });
        expect(mocks.invitations.revoke).toHaveBeenCalledWith("inv-1", "acme");
    });

    it("refuses a link without an id before it reads anything", async () => {
        mocks.viewer = LENA;

        expect(await revokeInvitation("")).toEqual({ success: false, error: "Invalid request" });
        expect(mocks.invitations.revoke).not.toHaveBeenCalled();
    });
});
