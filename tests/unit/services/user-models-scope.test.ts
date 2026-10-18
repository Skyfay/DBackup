/**
 * What the pages of the people say and read for someone of a platform group: the Profile promises
 * every permission in an opened tenant only to a platform admin, and the Groups tab of a tenant
 * reads the history of its own groups, so the entries of other tenants never push them out.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";
import { PERMISSIONS } from "@/lib/auth/permissions";

vi.mock("@/services/auth/password-policy-service", () => ({ getPasswordPolicy: vi.fn(async () => ({ minLength: 12 })) }));
vi.mock("@/services/user/preference-service", () => ({ getTaskColors: vi.fn(async () => ({})) }));
vi.mock("@/services/user/tenant-group-templates", () => ({ tenantGroupTemplates: { list: vi.fn(async () => []) } }));

const { getProfileModel } = await import("@/services/user/profile-model");
const { getGroupsModel } = await import("@/services/user/groups-model");

const EVERY_PERMISSION_NOTE = "Changes the connections, jobs and backups of a tenant after opening it, with every permission there.";

describe("the access the Profile names in All tenants", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        prismaMock.user.findUniqueOrThrow.mockResolvedValue({
            id: "nina", name: "Nina", email: "nina@example.ch", image: null, timezone: "", dateFormat: "P", timeFormat: "p",
            autoRedirectOnJobStart: true, twoFactorEnabled: false, passkeyTwoFactor: false, memberships: [],
        } as never);
        prismaMock.account.count.mockResolvedValue(1);
        prismaMock.ssoProvider.count.mockResolvedValue(0);
        prismaMock.session.count.mockResolvedValue(1);
    });

    it("promises every permission in an opened tenant to a platform admin", async () => {
        const model = await getProfileModel("root", { permissions: [PERMISSIONS.JOBS.READ], isPlatformAdmin: true, tenantId: null, allTenants: true });

        expect(model.access).toContain(EVERY_PERMISSION_NOTE);
    });

    it("promises nothing of the kind to someone of a platform group, whose groups decide it", async () => {
        const model = await getProfileModel("nina", { permissions: [PERMISSIONS.JOBS.READ], isPlatformAdmin: false, tenantId: null, allTenants: true });

        expect(model.access).not.toContain(EVERY_PERMISSION_NOTE);
        expect(model.access.length).toBeGreaterThan(0);
    });
});

describe("the history of the groups of a tenant", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        prismaMock.group.findMany.mockResolvedValue([
            { id: "g-ops", name: "Operators", permissions: "[]", fullAccess: false, createdAt: new Date("2026-10-01T00:00:00Z"), templateId: null, memberships: [] },
            { id: "g-view", name: "Viewers", permissions: "[]", fullAccess: false, createdAt: new Date("2026-10-01T00:00:00Z"), templateId: null, memberships: [] },
        ] as never);
        prismaMock.user.findMany.mockResolvedValue([] as never);
        prismaMock.auditLog.findMany.mockResolvedValue([
            { resourceId: "g-ops", action: "CREATE", createdAt: new Date("2026-10-01T00:00:00Z"), actorName: "Lena", user: { name: "Lena" } },
        ] as never);
    });

    it("reads only the entries of the groups of that tenant, wherever they were written", async () => {
        const model = await getGroupsModel("lena", false, true, "acme");

        const where = (prismaMock.auditLog.findMany.mock.calls[0][0] as { where: Record<string, unknown> }).where;
        expect(where).toEqual(expect.objectContaining({ resource: "GROUP", resourceId: { in: ["g-ops", "g-view"] } }));
        expect(model.groups.find((group) => group.id === "g-ops")).toEqual(expect.objectContaining({ made: expect.objectContaining({ by: "Lena" }) }));
    });
});
