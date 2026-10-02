import { beforeEach, describe, expect, it, vi } from "vitest";
import { ValidationError } from "@/lib/logging/errors";

const mocks = vi.hoisted(() => ({
    viewer: { id: "u1", name: "Lena Graf", email: "lena@example.ch", group: { name: "Operators" } },
    account: { id: "a1" } as { id: string } | null,
    verifyPassword: vi.fn(),
    setPassword: vi.fn(),
    revokeSessions: vi.fn(),
    audit: vi.fn(),
}));

vi.mock("@/lib/auth/access-control", () => ({
    getCurrentUserWithGroup: vi.fn(async () => mocks.viewer),
    hasPermission: vi.fn(async () => true),
    checkPermission: vi.fn(),
    currentSessionId: vi.fn(async () => "s-here"),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ default: { account: { findFirst: vi.fn(async () => mocks.account) } } }));
vi.mock("@/services/auth/auth-service", () => ({ authService: { verifyPassword: mocks.verifyPassword, setPassword: mocks.setPassword } }));
vi.mock("@/services/user/user-service", () => ({ userService: { revokeSessions: mocks.revokeSessions } }));
vi.mock("@/services/audit-service", () => ({ auditService: { log: mocks.audit } }));
vi.mock("@/services/notifications/system-notification-service", () => ({ notify: vi.fn(async () => undefined) }));

const { updateOwnPassword } = await import("@/app/actions/auth/user");

describe("changing the own password under Profile", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.account = { id: "a1" };
        mocks.verifyPassword.mockResolvedValue(true);
        mocks.setPassword.mockResolvedValue(undefined);
        mocks.revokeSessions.mockResolvedValue(2);
    });

    it("refuses a wrong current password and changes nothing", async () => {
        mocks.verifyPassword.mockResolvedValue(false);

        expect(await updateOwnPassword("not-the-one", "Harbor-Lamp-42")).toEqual({ success: false, error: "Incorrect current password" });

        expect(mocks.verifyPassword).toHaveBeenCalledWith("u1", "not-the-one");
        expect(mocks.setPassword).not.toHaveBeenCalled();
        expect(mocks.revokeSessions).not.toHaveBeenCalled();
    });

    it("sets the new password, ends every other session and keeps the one in use", async () => {
        expect(await updateOwnPassword("old-secret", "Harbor-Lamp-42")).toEqual({ success: true, data: { signedOut: 2 } });

        expect(mocks.setPassword).toHaveBeenCalledWith("u1", "Harbor-Lamp-42");
        expect(mocks.revokeSessions).toHaveBeenCalledWith("u1", "s-here");
        expect(mocks.audit).toHaveBeenCalledWith("u1", "UPDATE", "USER", { change: "Password Changed", signedOut: 2 }, "u1");
    });

    it("hands on the rule of Settings > Passwords that the new password breaks", async () => {
        mocks.setPassword.mockRejectedValue(new ValidationError("The password needs a number."));

        expect(await updateOwnPassword("old-secret", "Harbor-Lamp")).toEqual({ success: false, error: "The password needs a number." });
        expect(mocks.revokeSessions).not.toHaveBeenCalled();
        expect(mocks.audit).not.toHaveBeenCalled();
    });

    it("asks for both passwords and needs a password account", async () => {
        expect(await updateOwnPassword("", "Harbor-Lamp-42")).toEqual({ success: false, error: "Enter the password you have now." });

        mocks.account = null;
        expect(await updateOwnPassword("old-secret", "Harbor-Lamp-42")).toEqual({ success: false, error: "No password account found. Please set up a password first." });
        expect(mocks.verifyPassword).not.toHaveBeenCalled();
    });
});
