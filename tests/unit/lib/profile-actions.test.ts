import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { DEFAULT_TASK_COLORS } from "@/lib/core/task-colors";

const mocks = vi.hoisted(() => ({
    viewer: { id: "u1", name: "Lena Graf", email: "lena@example.ch", timezone: "", dateFormat: "P", timeFormat: "p", group: { name: "Operators" } } as Record<string, unknown> | null,
    held: new Set<string>(),
    updateUser: vi.fn(),
    setTaskColors: vi.fn(),
    audit: vi.fn(),
}));

vi.mock("@/lib/auth/access-control", () => ({
    getCurrentUserWithGroup: vi.fn(async () => mocks.viewer),
    hasPermission: vi.fn(async (permission: string) => mocks.held.has(permission)),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/services/audit-service", () => ({ auditService: { log: mocks.audit } }));
vi.mock("@/services/user/user-service", () => ({ userService: { updateUser: mocks.updateUser } }));
vi.mock("@/services/user/preference-service", () => ({ setTaskColors: mocks.setTaskColors }));

const { saveProfileAccountAction, saveProfileDatesAction, saveTaskColorsAction } = await import("@/app/actions/auth/profile");

describe("the account of the own profile", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.held = new Set(["profile:update_name", "profile:update_email"]);
        mocks.updateUser.mockResolvedValue({});
    });

    it("saves a new name and email and writes what changed", async () => {
        expect(await saveProfileAccountAction({ name: "Lena Keller", email: "Lena.Keller@example.ch" })).toEqual({ success: true });

        expect(mocks.updateUser).toHaveBeenCalledWith("u1", { name: "Lena Keller", email: "lena.keller@example.ch" });
        expect(mocks.audit).toHaveBeenCalledWith("u1", "UPDATE", "USER", {
            name: "Lena Keller",
            changes: [
                { field: "Name", from: "Lena Graf", to: "Lena Keller" },
                { field: "Email", from: "lena@example.ch", to: "lena.keller@example.ch" },
            ],
        }, "u1");
    });

    it("keeps the name and the email to what the group allows, also when the browser skips the page", async () => {
        mocks.held = new Set(["profile:update_email"]);
        expect(await saveProfileAccountAction({ name: "Someone Else", email: "lena@example.ch" })).toEqual({ success: false, error: "Your group may not change your name.", field: "name" });

        mocks.held = new Set(["profile:update_name"]);
        expect(await saveProfileAccountAction({ name: "Lena Graf", email: "boss@example.ch" })).toEqual({ success: false, error: "Your group may not change your email.", field: "email" });
        expect(mocks.updateUser).not.toHaveBeenCalled();

        // A field that stays as it is needs no permission.
        mocks.held = new Set();
        expect(await saveProfileAccountAction({ name: "Lena Graf", email: "lena@example.ch" })).toEqual({ success: true });
    });

    it("names the field when another account signs in with the email", async () => {
        mocks.updateUser.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "6" }));

        expect(await saveProfileAccountAction({ name: "Lena Graf", email: "taken@example.ch" })).toEqual({ success: false, error: "Another account signs in with this email.", field: "email" });
    });

    it("refuses someone who is not signed in", async () => {
        mocks.viewer = null;
        expect(await saveProfileAccountAction({ name: "Lena Graf", email: "lena@example.ch" })).toEqual({ success: false, error: "Unauthorized" });
        mocks.viewer = { id: "u1", name: "Lena Graf", email: "lena@example.ch", timezone: "", dateFormat: "P", timeFormat: "p", group: { name: "Operators" } };
    });
});

describe("the dates and colors of the own profile", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.updateUser.mockResolvedValue({});
        mocks.setTaskColors.mockResolvedValue(undefined);
    });

    it("saves a time zone and formats it knows, and empty for the one of the browser", async () => {
        expect(await saveProfileDatesAction({ timezone: "Europe/Zurich", dateFormat: "dd.MM.yyyy", timeFormat: "HH:mm" })).toEqual({ success: true });
        expect(mocks.updateUser).toHaveBeenCalledWith("u1", { timezone: "Europe/Zurich", dateFormat: "dd.MM.yyyy", timeFormat: "HH:mm" });
        expect(await saveProfileDatesAction({ timezone: "", dateFormat: "P", timeFormat: "p" })).toEqual({ success: true });
    });

    it("refuses a zone or a format the page does not offer", async () => {
        expect(await saveProfileDatesAction({ timezone: "Mars/Olympus", dateFormat: "P", timeFormat: "p" })).toMatchObject({ success: false, field: "timezone" });
        expect(await saveProfileDatesAction({ timezone: "", dateFormat: "yyyy <b>", timeFormat: "p" })).toMatchObject({ success: false, field: "dateFormat" });
        expect(mocks.updateUser).not.toHaveBeenCalled();
    });

    it("stores the colors of the tasks and refuses anything but families and #rrggbb", async () => {
        expect(await saveTaskColorsAction({ ...DEFAULT_TASK_COLORS, destructive: "orange" })).toEqual({ success: true });
        expect(mocks.setTaskColors).toHaveBeenCalledWith("u1", { ...DEFAULT_TASK_COLORS, destructive: "orange" });

        expect(await saveTaskColorsAction({ ...DEFAULT_TASK_COLORS, destructive: "red}body{" as never })).toMatchObject({ success: false, field: "destructive" });
        expect(mocks.setTaskColors).toHaveBeenCalledTimes(1);
    });
});
