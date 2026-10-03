import { beforeEach, describe, expect, it, vi } from "vitest";
import { PermissionError } from "@/lib/logging/errors";

const mocks = vi.hoisted(() => ({
    viewer: { id: "u1", name: "Lena Graf", email: "lena@example.ch", group: { name: "Operators" } },
    held: new Set<string>(),
    service: { updateUser: vi.fn(), togglePasskeyTwoFactor: vi.fn() },
    audit: vi.fn(),
}));

vi.mock("@/lib/auth/access-control", () => ({
    getCurrentUserWithGroup: vi.fn(async () => mocks.viewer),
    hasPermission: vi.fn(async (permission: string) => mocks.held.has(permission)),
    checkPermission: vi.fn(async (permission: string) => {
        if (!mocks.held.has(permission)) throw new PermissionError(permission);
        return mocks.viewer;
    }),
}));
vi.mock("@/lib/auth", () => ({ auth: { api: { unlinkAccount: vi.fn(), signInEmail: vi.fn(), setPassword: vi.fn() } } }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ default: { account: { count: vi.fn(async () => 2), findFirst: vi.fn() }, ssoProvider: { findUnique: vi.fn() } } }));
vi.mock("@/services/user/user-service", () => ({ userService: mocks.service }));
vi.mock("@/services/audit-service", () => ({ auditService: { log: mocks.audit } }));
vi.mock("@/services/notifications/system-notification-service", () => ({ notify: vi.fn(async () => undefined) }));

const { togglePasskeyTwoFactor, updateOwnPassword, updateUser } = await import("@/app/actions/auth/user");
const { initiateSsoConnect, unlinkMySsoAccount } = await import("@/app/actions/auth/sso-connections");

describe("what a group lets someone change of the own profile", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.held = new Set();
        mocks.service.updateUser.mockResolvedValue({});
        mocks.service.togglePasskeyTwoFactor.mockResolvedValue({});
    });

    it("keeps the password to a group that may change it", async () => {
        expect(await updateOwnPassword("old-secret", "new-secret-123")).toEqual({ success: false, error: "Your group may not change your password." });
    });

    it("keeps the passkey as second factor to a group that may change the passkeys", async () => {
        expect(await togglePasskeyTwoFactor("u1", true)).toEqual({ success: false, error: "Your group may not change your passkeys." });
        expect(mocks.service.togglePasskeyTwoFactor).not.toHaveBeenCalled();

        mocks.held = new Set(["profile:manage_passkeys"]);
        expect(await togglePasskeyTwoFactor("u1", true)).toEqual({ success: true });
    });

    it("changes the own name and email only as far as the group allows, unless it may change users", async () => {
        expect(await updateUser("u1", { name: "Someone Else" })).toEqual({ success: false, error: "Your group may not change your name." });
        expect(await updateUser("u1", { email: "boss@example.ch" })).toEqual({ success: false, error: "Your group may not change your email." });
        expect(mocks.service.updateUser).not.toHaveBeenCalled();

        mocks.held = new Set(["users:write"]);
        expect(await updateUser("u1", { name: "Someone Else" })).toEqual({ success: true });
    });

    it("keeps the linked sign-in providers to a group that may change them", async () => {
        const refused = { success: false, error: "Your group may not change your sign-in providers." };
        expect(await unlinkMySsoAccount("authentik", "acc-1")).toEqual(refused);
        expect(await initiateSsoConnect("authentik")).toEqual(refused);
    });
});
