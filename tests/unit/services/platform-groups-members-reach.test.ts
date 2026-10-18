// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    db: { user: { count: vi.fn(), findMany: vi.fn() }, auditLog: { findMany: vi.fn() } },
    reachOf: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ default: mocks.db }));
vi.mock("@/services/tenant/tenant-summaries", () => ({ tenantSummaries: vi.fn().mockResolvedValue([]) }));
vi.mock("@/services/tenant/tenant-service", () => ({
    tenantService: { switchable: vi.fn().mockResolvedValue([{ id: "acme", name: "Acme" }]) },
}));
vi.mock("@/services/user/platform-group-service", () => ({
    platformGroupService: {
        reachOf: mocks.reachOf,
        shapeOf: vi.fn().mockResolvedValue({ id: "pg-acme", shape: { platformPermissions: [], tenantPermissions: [], allTenants: false, tenantIds: ["acme"] } }),
        platformAdmins: vi.fn().mockResolvedValue([{ id: "root", name: "Root", email: "root@msp.example", image: null }]),
        list: vi.fn().mockResolvedValue([
            {
                id: "pg-acme",
                name: "Support Acme",
                createdAt: new Date("2026-10-01T00:00:00.000Z"),
                platformPermissions: ["platform-accounts:read"],
                tenantPermissions: [],
                allTenants: false,
                tenantIds: ["acme"],
                members: [
                    { id: "nina", name: "Nina", email: "nina@msp.example", image: null },
                    { id: "otto", name: "Otto", email: "otto@msp.example", image: null },
                ],
            },
        ]),
    },
}));

const { getPlatformGroupListModel } = await import("@/services/user/platform-groups-model");

const viewer = { id: "nina", platformAdmin: false, permissions: ["platform-accounts:read"] };
const membersOf = (model: Awaited<ReturnType<typeof getPlatformGroupListModel>>) =>
    Object.fromEntries(model.groups.map((group) => [group.id, group.members.map((member) => member.id)]));

beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.auditLog.findMany.mockResolvedValue([]);
    mocks.db.user.count.mockResolvedValue(2);
});

describe("the platform groups someone of a platform group of some tenants sees", () => {
    it("show only the members whose accounts they see, their own too, and count only those accounts", async () => {
        mocks.reachOf.mockResolvedValue(["acme"]);
        // Otto works in Acme, the platform admin in no tenant.
        mocks.db.user.findMany.mockResolvedValue([{ id: "nina" }, { id: "otto" }]);

        const model = await getPlatformGroupListModel(viewer);

        expect(membersOf(model)).toEqual({ "platform-admin": [], "pg-acme": ["nina", "otto"] });
        const seen = { OR: [{ id: "nina" }, { memberships: { some: { tenantId: { in: ["acme"] } } } }] };
        expect(mocks.db.user.count).toHaveBeenCalledWith({ where: seen });
        expect(mocks.db.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { AND: [{ id: { in: ["root", "nina", "otto"] } }, seen] } }));
    });

    it("keep every member for a platform group of all tenants and a platform admin", async () => {
        mocks.reachOf.mockResolvedValue("all");

        const model = await getPlatformGroupListModel(viewer);

        expect(membersOf(model)).toEqual({ "platform-admin": ["root"], "pg-acme": ["nina", "otto"] });
        expect(mocks.db.user.findMany).not.toHaveBeenCalled();
        expect(mocks.db.user.count).toHaveBeenCalledWith({ where: undefined });
    });
});
