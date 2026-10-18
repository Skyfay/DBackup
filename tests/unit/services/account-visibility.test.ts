import { beforeEach, describe, expect, it } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { explicitScope } from "@/lib/tenant/context";
import { findVisibleAvatar, maySeeAccount, maySeePicture, type AccountViewer } from "@/services/user/account-visibility";

const member = (tenantId: string | null, ...permissions: string[]): AccountViewer => ({ userId: "lena", tenantId, allTenants: false, isPlatformAdmin: false, permissions });

/** The platform group of the viewer, as `platformGroupService` reads it. */
const platformGroup = (scope: { allTenants: boolean; tenants: { tenantId: string }[] }) =>
    prismaMock.user.findUnique.mockResolvedValue({ platformRole: null, platformGroup: { id: "pg", platformPermissions: "[]", tenantPermissions: "[]", ...scope } } as never);

beforeEach(() => {
    prismaMock.user.findUnique.mockReset();
    prismaMock.user.count.mockReset();
});

/** The where of the last count of accounts, for the tenant it names. */
const lastUserWhere = () => JSON.stringify(prismaMock.user.count.mock.calls.at(-1)?.[0]);

describe("who opens the panel of an account", () => {
    beforeEach(() => {
        prismaMock.user.count.mockResolvedValue(0);
    });

    it("opens the own account without asking the database", async () => {
        expect(await maySeeAccount(member("t-acme"), "lena")).toBe(true);
        expect(prismaMock.user.count).not.toHaveBeenCalled();
    });

    it("opens an account the Users tab of the tenant lists, and none of another tenant", async () => {
        prismaMock.user.count.mockResolvedValueOnce(1);
        expect(await maySeeAccount(member("t-acme", PERMISSIONS.USERS.READ), "max")).toBe(true);
        expect(lastUserWhere()).toContain('"tenantId":"t-acme"');

        expect(await maySeeAccount(member("t-acme", PERMISSIONS.USERS.READ), "someone-of-globex")).toBe(false);
    });

    it("opens every account for a platform admin, a platform group of all tenants that may see the accounts of the platform and in All tenants", async () => {
        platformGroup({ allTenants: true, tenants: [] });
        expect(await maySeeAccount({ ...member(null), isPlatformAdmin: true }, "max")).toBe(true);
        expect(await maySeeAccount(member("t-acme", PERMISSIONS.PLATFORM.ACCOUNTS_READ), "max")).toBe(true);
        expect(await maySeeAccount({ ...member(null, PERMISSIONS.PLATFORM.ACCOUNTS_READ), allTenants: true }, "max")).toBe(true);
        expect(prismaMock.user.count).not.toHaveBeenCalled();
    });

    it("opens for a platform group of some tenants only the accounts that work in one of them", async () => {
        // Lena's platform group reaches Acme and Shop, she works in Globex.
        platformGroup({ allTenants: false, tenants: [{ tenantId: "t-acme" }, { tenantId: "t-shop" }] });
        const viewer = member("t-globex", PERMISSIONS.PLATFORM.ACCOUNTS_READ, PERMISSIONS.PLATFORM.ACCOUNTS_WRITE);

        prismaMock.user.count.mockResolvedValueOnce(1);
        expect(await maySeeAccount(viewer, "tom-of-acme")).toBe(true);
        expect(JSON.stringify(prismaMock.user.count.mock.calls[0][0])).toContain('"tenantId":{"in":["t-acme","t-shop"]}');

        // Neither a member of a tenant it reaches nor one of the tenant she works in.
        expect(await maySeeAccount(viewer, "someone-of-initech")).toBe(false);
    });

    it("opens no other account for someone of no tenant", async () => {
        expect(await maySeeAccount(member(null, PERMISSIONS.USERS.READ), "max")).toBe(false);
        expect(prismaMock.user.count).not.toHaveBeenCalled();
    });
});

describe("who sees the picture of an account", () => {
    beforeEach(() => {
        prismaMock.user.count.mockResolvedValue(0);
        prismaMock.auditLog.count.mockResolvedValue(0);
        prismaMock.apiKey.count.mockResolvedValue(0);
    });

    it("shows the people of the tenant and the people of the platform who open it", async () => {
        prismaMock.user.count.mockResolvedValueOnce(1);
        expect(await maySeePicture(member("t-acme"), "support-of-the-msp")).toBe(true);
        expect(lastUserWhere()).toContain('"platformRole":"ADMIN"');
        expect(lastUserWhere()).toContain('"tenants":{"some":{"tenantId":"t-acme"}}');
    });

    it("shows whoever acted in the tenant, read in that tenant", async () => {
        const scopes: unknown[] = [];
        prismaMock.auditLog.count.mockImplementation((async () => {
            scopes.push(explicitScope());
            return 2;
        }) as never);

        expect(await maySeePicture(member("t-acme"), "former-member")).toBe(true);
        expect(scopes).toEqual([{ kind: "tenant", tenantId: "t-acme" }]);
        expect(prismaMock.auditLog.count).toHaveBeenCalledWith({ where: { userId: "former-member" } });
    });

    it("shows nobody of another tenant who never acted in this one", async () => {
        expect(await maySeePicture(member("t-acme"), "someone-of-globex")).toBe(false);
    });

    it("shows everyone to whoever lists the people of every tenant", async () => {
        expect(await maySeePicture(member("t-acme", PERMISSIONS.PLATFORM.SIGN_IN_READ), "someone-of-globex")).toBe(true);
        expect(prismaMock.user.count).not.toHaveBeenCalled();

        platformGroup({ allTenants: true, tenants: [] });
        expect(await maySeePicture(member("t-acme", PERMISSIONS.PLATFORM.SIGN_IN_READ), "someone-of-globex")).toBe(true);
    });

    it("shows a platform group of some tenants the people of the sign-in providers and the accounts of those tenants alone", async () => {
        platformGroup({ allTenants: false, tenants: [{ tenantId: "t-shop" }] });

        expect(await maySeePicture(member("t-acme", PERMISSIONS.PLATFORM.SIGN_IN_READ), "someone-of-globex")).toBe(false);
        expect(await maySeePicture(member("t-acme", PERMISSIONS.PLATFORM.ACCOUNTS_READ), "someone-of-globex")).toBe(false);
        expect(JSON.stringify(prismaMock.user.count.mock.calls[0][0])).toContain('"tenantId":{"in":["t-shop"]}');
    });
});

describe("the picture behind an address", () => {
    beforeEach(() => {
        prismaMock.user.count.mockResolvedValue(0);
        prismaMock.auditLog.count.mockResolvedValue(0);
        prismaMock.apiKey.count.mockResolvedValue(0);
        prismaMock.avatar.findUnique.mockResolvedValue({ data: Buffer.from([1, 2, 3]), mimeType: "image/png" } as never);
    });

    it("hands out the picture of an account the viewer sees", async () => {
        expect(await findVisibleAvatar(member("t-acme"), "lena")).toEqual({ data: new Uint8Array([1, 2, 3]), mimeType: "image/png" });
        expect(prismaMock.avatar.findUnique).toHaveBeenCalledWith({ where: { userId: "lena" }, select: { data: true, mimeType: true } });
    });

    it("reads no picture of an account the viewer may not see, also behind a file name of an earlier version", async () => {
        expect(await findVisibleAvatar(member("t-acme"), "someone-of-globex")).toBeNull();
        expect(await findVisibleAvatar(member("t-acme"), "someone-of-globex-1727000000000.png")).toBeNull();
        expect(prismaMock.avatar.findUnique).not.toHaveBeenCalled();
    });

    it("finds the own picture behind a file name of an earlier version", async () => {
        expect(await findVisibleAvatar(member("t-acme"), "lena-1727000000000.png")).not.toBeNull();
        expect(prismaMock.avatar.findUnique).toHaveBeenCalledWith({ where: { userId: "lena" }, select: { data: true, mimeType: true } });
    });
});
