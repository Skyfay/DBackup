import { beforeEach, describe, expect, it, vi } from "vitest";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { NotFoundError, ValidationError } from "@/lib/logging/errors";

const db = vi.hoisted(() => ({
    platformGroup: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    platformGroupTenant: { deleteMany: vi.fn() },
    tenant: { findMany: vi.fn() },
    user: { findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: db }));

const { platformGroupService } = await import("@/services/user/platform-group-service");

const P = PERMISSIONS;
const STORED = {
    name: "Support",
    platformPermissions: JSON.stringify([P.PLATFORM.TENANTS_READ]),
    tenantPermissions: JSON.stringify([P.JOBS.READ]),
    allTenants: true,
    tenants: [],
};

const input = (over: Partial<Parameters<typeof platformGroupService.create>[0]> = {}) => ({
    name: "Support",
    platformPermissions: [P.PLATFORM.TENANTS_READ],
    tenantPermissions: [P.JOBS.READ, P.JOBS.EXECUTE],
    allTenants: true,
    tenantIds: [],
    ...over,
});

beforeEach(() => {
    vi.clearAllMocks();
    // A transaction runs its callback with the client, or settles a list of queries.
    db.$transaction.mockImplementation(async (work: unknown) => (typeof work === "function" ? (work as (tx: typeof db) => unknown)(db) : Promise.all(work as unknown[])));
    db.platformGroup.findFirst.mockResolvedValue(null);
    db.platformGroup.create.mockResolvedValue({ id: "pg-1" });
    db.tenant.findMany.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.filter((id) => id !== "gone").map((id) => ({ id })));
});

describe("making a platform group", () => {
    it("stores only the rights it may hold: those of the platform apart, never the settings of the instance among the rights in the tenants", async () => {
        await platformGroupService.create(input({
            platformPermissions: [P.PLATFORM.TENANTS_READ, P.JOBS.READ, "made-up:right"],
            tenantPermissions: [P.JOBS.READ, P.SETTINGS.WRITE, P.PLATFORM.TENANTS_WRITE],
        }));

        const data = db.platformGroup.create.mock.calls[0][0].data;
        expect(JSON.parse(data.platformPermissions)).toEqual([P.PLATFORM.TENANTS_READ]);
        expect(JSON.parse(data.tenantPermissions)).toEqual([P.JOBS.READ]);
    });

    it("keeps the tenants of its scope that exist, and none for All tenants", async () => {
        await platformGroupService.create(input({ allTenants: false, tenantIds: ["acme", "gone", "acme"] }));
        expect(db.platformGroup.create.mock.calls[0][0].data.tenants).toEqual({ create: [{ tenantId: "acme" }] });

        await platformGroupService.create(input({ allTenants: true, tenantIds: ["acme"] }));
        expect(db.platformGroup.create.mock.calls[1][0].data.tenants).toEqual({ create: [] });
    });

    it("refuses rights in the tenants without a tenant for them to count in", async () => {
        await expect(platformGroupService.create(input({ allTenants: false, tenantIds: [] }))).rejects.toThrow("Pick the tenants where its rights count, or All tenants.");
        // Rights on the platform alone need no tenant.
        await expect(platformGroupService.create(input({ allTenants: false, tenantIds: [], tenantPermissions: [] }))).resolves.toMatchObject({ id: "pg-1" });
    });

    it("keeps names apart, and never takes the name of the built-in Platform admin", async () => {
        db.platformGroup.findFirst.mockResolvedValue({ id: "pg-other" });
        await expect(platformGroupService.create(input())).rejects.toBeInstanceOf(ValidationError);
        db.platformGroup.findFirst.mockResolvedValue(null);
        await expect(platformGroupService.create(input({ name: "platform admin" }))).rejects.toThrow("Platform admin is the name of the built-in platform group.");
        expect(db.platformGroup.create).not.toHaveBeenCalled();
    });
});

describe("changing a platform group", () => {
    it("says what changed: the name, the levels of the areas and where it counts", async () => {
        db.platformGroup.findUnique.mockResolvedValue(STORED);

        const change = await platformGroupService.update("pg-1", input({ name: "Helpdesk", allTenants: false, tenantIds: ["acme"] }));

        expect(change).toEqual({
            name: "Helpdesk",
            renamedFrom: "Support",
            areas: [{ area: "jobs", from: "see", to: "use" }],
            changes: [{ field: "Where", from: "All tenants, new ones too", to: "1 tenant" }],
        });
        // The tenants of the scope are written anew with the group.
        expect(db.platformGroupTenant.deleteMany).toHaveBeenCalledWith({ where: { groupId: "pg-1" } });
    });

    it("refuses a group that is gone", async () => {
        db.platformGroup.findUnique.mockResolvedValue(null);
        await expect(platformGroupService.update("pg-gone", input())).rejects.toBeInstanceOf(NotFoundError);
    });
});

describe("giving an account its platform group", () => {
    it("makes a platform admin and clears the platform group, since an account holds one of them", async () => {
        db.user.findUnique.mockResolvedValue({ platformRole: null, platformGroup: { name: "Support" } });

        expect(await platformGroupService.setFor("lena", { kind: "admin" })).toEqual({ from: "Support", to: "Platform admin" });
        expect(db.user.update).toHaveBeenCalledWith({ where: { id: "lena" }, data: { platformRole: "ADMIN", platformGroupId: null } });
    });

    it("gives a platform group in place of the platform admin role while another platform admin is left", async () => {
        db.user.findUnique.mockResolvedValue({ platformRole: "ADMIN", platformGroup: null });
        db.user.count.mockResolvedValue(1);
        db.platformGroup.findUnique.mockResolvedValue({ name: "Support" });

        expect(await platformGroupService.setFor("lena", { kind: "group", id: "pg-1" })).toEqual({ from: "Platform admin", to: "Support" });
        expect(db.user.update).toHaveBeenCalledWith({ where: { id: "lena" }, data: { platformRole: null, platformGroupId: "pg-1" } });
    });

    it("keeps the last platform admin one", async () => {
        db.user.findUnique.mockResolvedValue({ platformRole: "ADMIN", platformGroup: null });
        db.user.count.mockResolvedValue(0);

        await expect(platformGroupService.setFor("root", { kind: "none" })).rejects.toThrow("The last platform admin stays one.");
        expect(db.user.update).not.toHaveBeenCalled();
    });

    it("takes the platform group away with none, and refuses a group that is gone", async () => {
        db.user.findUnique.mockResolvedValue({ platformRole: null, platformGroup: { name: "Support" } });
        expect(await platformGroupService.setFor("lena", { kind: "none" })).toEqual({ from: "Support", to: "No platform group" });
        expect(db.user.update).toHaveBeenCalledWith({ where: { id: "lena" }, data: { platformRole: null, platformGroupId: null } });

        db.platformGroup.findUnique.mockResolvedValue(null);
        await expect(platformGroupService.setFor("lena", { kind: "group", id: "pg-gone" })).rejects.toThrow("The platform group no longer exists.");
    });
});

describe("the people a platform group reaches", () => {
    const group = (tenantIds: string[]) => db.user.findUnique.mockResolvedValue({
        platformGroup: { id: "pg-1", platformPermissions: "[]", tenantPermissions: "[]", allTenants: false, tenants: tenantIds.map((tenantId) => ({ tenantId })) },
    });
    const where = () => JSON.stringify(db.user.findMany.mock.calls.at(-1)?.[0]?.where);

    it("count an account of no tenant as one of the home tenant, like the Users tab and the checks of an account", async () => {
        group(["default", "acme"]);
        db.user.findMany.mockResolvedValue([{ id: "anna" }, { id: "new-hire" }]);

        expect(await platformGroupService.peopleReached("nina")).toEqual(["anna", "new-hire"]);
        expect(where()).toContain('"memberships":{"none":{}}');
    });

    it("leave the accounts of no tenant out for a group that does not reach the home tenant", async () => {
        group(["acme"]);
        db.user.findMany.mockResolvedValue([]);

        await platformGroupService.peopleReached("nina");

        expect(where()).not.toContain('"none"');
        expect(where()).toContain('"tenantId":{"in":["acme"]}');
    });
});

describe("deleting a platform group", () => {
    it("deletes it and says how many held it, who keep their accounts", async () => {
        db.platformGroup.findUnique.mockResolvedValue({ name: "Support", _count: { members: 3 } });

        expect(await platformGroupService.delete("pg-1")).toEqual({ name: "Support", members: 3 });
        expect(db.platformGroup.delete).toHaveBeenCalledWith({ where: { id: "pg-1" } });
    });
});
