/**
 * The groups a deleted account comes back with cap who restores it or deletes it for good, like
 * they cap a change of the live account. Whoever restores an account may give it a new email and
 * sign in as it, so the admin of a tenant who may not do everything never brings back its Admin.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GROUP_BEYOND_ACCOUNT_REFUSAL } from "@/lib/auth/account-access";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { explicitScope } from "@/lib/tenant/context";

type StoredGroup = { id: string; tenantId: string; permissions: string; fullAccess: boolean };

const mocks = vi.hoisted(() => ({
    /** The snapshots in Recently deleted, by the id of the entry. */
    snapshots: new Map<string, unknown>(),
    groups: [] as StoredGroup[],
    /** What the caller may do in a tenant other than the one they work in. */
    elsewhere: {} as Record<string, string[]>,
    lookedUpIn: [] as (string | null)[],
}));

vi.mock("@/lib/prisma", () => ({
    default: {
        deletedRecord: {
            findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
                where.id.in.flatMap((id) => (mocks.snapshots.has(id) ? [{ id, data: JSON.stringify(mocks.snapshots.get(id)) }] : []))),
        },
        group: {
            // Like the scope of the client: a group is found only in the tenant it belongs to.
            findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
                const scope = explicitScope();
                const tenantId = scope?.kind === "tenant" ? scope.tenantId : null;
                mocks.lookedUpIn.push(tenantId);
                const group = mocks.groups.find((entry) => entry.id === where.id && entry.tenantId === tenantId);
                return group ? { permissions: group.permissions, fullAccess: group.fullAccess } : null;
            }),
        },
    },
}));
vi.mock("@/services/user/user-service", () => ({
    userService: {
        permissionsByTenantFor: vi.fn(async (caller: { tenantId: string | null }, groups: { tenantId: string }[]) =>
            Object.fromEntries(groups.filter((group) => group.tenantId !== caller.tenantId).map((group) => [group.tenantId, mocks.elsewhere[group.tenantId] ?? []]))),
    },
}));

const { groupBeyondRefusals, snapshotGroups, trashAccountCaps } = await import("@/services/trash/account-groups");

const ADMIN: StoredGroup = { id: "acme-admin", tenantId: "acme", permissions: "[]", fullAccess: true };
const VIEWERS: StoredGroup = { id: "acme-viewers", tenantId: "acme", permissions: JSON.stringify([PERMISSIONS.JOBS.READ]), fullAccess: false };

const snapshot = (memberships: { tenantId: string; groupId: string }[] | undefined, groupId?: string) => ({
    record: { id: "u", email: "u@acme.example", ...(groupId ? { groupId } : {}) },
    ...(memberships ? { memberships } : {}),
});

/** Lena manages the users of Acme and may change its settings, nothing more. */
const LENA = { id: "lena", isPlatformAdmin: false, tenantId: "acme", permissions: [PERMISSIONS.USERS.WRITE, PERMISSIONS.TENANT_SETTINGS.WRITE, PERMISSIONS.JOBS.READ] };

const entry = (id: string, name: string) => ({ id, kind: "user", name });

describe("the groups of a deleted account", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.snapshots = new Map();
        mocks.groups = [ADMIN, VIEWERS];
        mocks.elsewhere = {};
        mocks.lookedUpIn = [];
    });

    it("refuses the admin of a tenant who brings back its full access Admin", async () => {
        mocks.snapshots.set("t-boss", snapshot([{ tenantId: "acme", groupId: "acme-admin" }]));

        expect(await groupBeyondRefusals(LENA, [entry("t-boss", "Boss")])).toEqual([{ id: "t-boss", name: "Boss", error: GROUP_BEYOND_ACCOUNT_REFUSAL }]);
    });

    it("refuses only the accounts of a batch whose group is beyond the caller, and passes every other record", async () => {
        mocks.snapshots.set("t-boss", snapshot([{ tenantId: "acme", groupId: "acme-admin" }]));
        mocks.snapshots.set("t-carla", snapshot([{ tenantId: "acme", groupId: "acme-viewers" }]));

        const refused = await groupBeyondRefusals(LENA, [entry("t-boss", "Boss"), entry("t-carla", "Carla"), { id: "t-job", kind: "job", name: "Shop nightly" }]);

        expect(refused.map((row) => row.id)).toEqual(["t-boss"]);
    });

    it("lets a platform admin and someone who may do all of it bring the Admin back", async () => {
        mocks.snapshots.set("t-boss", snapshot([{ tenantId: "acme", groupId: "acme-admin" }]));

        expect(await groupBeyondRefusals({ ...LENA, isPlatformAdmin: true }, [entry("t-boss", "Boss")])).toEqual([]);
        const all = (await import("@/lib/auth/owner-permissions")).groupPermissions(ADMIN);
        expect(await groupBeyondRefusals({ ...LENA, permissions: all }, [entry("t-boss", "Boss")])).toEqual([]);
    });

    it("weighs a group in another tenant against what the caller may there", async () => {
        mocks.groups = [...mocks.groups, { ...VIEWERS, id: "globex-viewers", tenantId: "globex" }];
        mocks.snapshots.set("t-gina", snapshot([{ tenantId: "globex", groupId: "globex-viewers" }]));

        expect(await groupBeyondRefusals(LENA, [entry("t-gina", "Gina")])).toHaveLength(1);
        mocks.elsewhere = { globex: [PERMISSIONS.JOBS.READ] };
        expect(await groupBeyondRefusals(LENA, [entry("t-gina", "Gina")])).toEqual([]);
    });

    it("looks each group up in the tenant of its membership, and counts a group deleted since for nobody", async () => {
        // The group id of Acme's Admin named under Globex finds nothing there.
        mocks.snapshots.set("t-boss", snapshot([{ tenantId: "globex", groupId: "acme-admin" }, { tenantId: "acme", groupId: "gone" }]));

        expect(await groupBeyondRefusals(LENA, [entry("t-boss", "Boss")])).toEqual([]);
        expect(mocks.lookedUpIn).toEqual(["globex", "acme"]);
    });

    it("reads the one group of the home tenant of a snapshot of an earlier version", async () => {
        mocks.groups = [{ ...ADMIN, tenantId: "default" }];

        expect(await snapshotGroups(snapshot(undefined, "acme-admin") as never)).toEqual([{ tenantId: "default", group: { permissions: "[]", fullAccess: true } }]);
    });

    it("hands Undo the groups and what the caller may in their other tenants", async () => {
        mocks.groups = [...mocks.groups, { ...VIEWERS, id: "globex-viewers", tenantId: "globex" }];
        mocks.snapshots.set("t-gina", snapshot([{ tenantId: "globex", groupId: "globex-viewers" }]));
        mocks.elsewhere = { globex: [PERMISSIONS.USERS.WRITE] };

        const caps = await trashAccountCaps(LENA, ["t-gina"], { anyTenant: true });

        expect(caps.groups.get("t-gina")).toEqual([{ tenantId: "globex", group: { permissions: VIEWERS.permissions, fullAccess: false } }]);
        expect(caps.permissionsByTenant).toEqual({ globex: [PERMISSIONS.USERS.WRITE] });
    });
});
