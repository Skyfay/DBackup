import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { DEFAULT_TASK_COLORS } from "@/lib/core/task-colors";

const mocks = vi.hoisted(() => ({
    viewer: { id: "u1", name: "Lena Graf", email: "lena@example.ch", timezone: "", dateFormat: "P", timeFormat: "p", group: { name: "Operators" } } as Record<string, unknown> | null,
    held: new Set<string>(),
    updateUser: vi.fn(),
    setTaskColors: vi.fn(),
    audit: vi.fn(),
    /** The check of an email that has an account, see tests/unit/services/new-account-email.test.ts. */
    taken: vi.fn(async (..._args: unknown[]): Promise<string | null> => null),
}));

const REFUSED = "This email cannot be given to this account. Pick another email.";

vi.mock("@/lib/auth/access-control", () => ({
    getViewer: vi.fn(async () => mocks.viewer),
    hasPermission: vi.fn(async (permission: string) => mocks.held.has(permission)),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/services/audit-service", () => ({ auditService: { log: mocks.audit } }));
vi.mock("@/services/user/user-service", () => ({ userService: { updateUser: mocks.updateUser, ownEmailRefusal: vi.fn(async () => null) } }));
vi.mock("@/services/user/preference-service", () => ({ setTaskColors: mocks.setTaskColors }));
vi.mock("@/services/user/new-account-email", () => ({
    CHANGED_EMAIL_ANSWERS: { known: "known", refused: REFUSED, spent: "spent" },
    EMAIL_REFUSED: REFUSED,
    takenEmailRefusal: (...args: unknown[]) => mocks.taken(...args),
}));

const { saveProfileAccountAction, saveProfileDatesAction, saveTaskColorsAction } = await import("@/app/actions/auth/profile");

describe("the account of the own profile", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.held = new Set(["profile:update_name", "profile:update_email"]);
        mocks.updateUser.mockResolvedValue({});
    });

    it("saves a new name and email and writes what changed", async () => {
        expect(await saveProfileAccountAction({ name: "Lena Keller", email: "Lena.Keller@example.ch" })).toEqual({ success: true });

        // An email the person picked themselves, which no sign-in provider links the account by.
        expect(mocks.updateUser).toHaveBeenCalledWith("u1", { name: "Lena Keller", email: "lena.keller@example.ch" }, "self");
        expect(mocks.audit).toHaveBeenCalledWith("u1", "UPDATE", "USER", {
            name: "Lena Keller",
            changes: [
                { field: "Name", from: "Lena Graf", to: "Lena Keller" },
                { field: "Email", from: "lena@example.ch", to: "lena.keller@example.ch" },
            ],
        }, "u1", { tenantId: "default" });
    });

    it("leaves the flag of the email alone when only the name changes", async () => {
        expect(await saveProfileAccountAction({ name: "Lena Keller", email: "lena@example.ch" })).toEqual({ success: true });
        expect(mocks.updateUser).toHaveBeenCalledWith("u1", { name: "Lena Keller", email: "lena@example.ch" }, undefined);
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

    it("answers an email taken meanwhile like any email it may not give, never saying that an account holds it", async () => {
        mocks.updateUser.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "6" }));

        expect(await saveProfileAccountAction({ name: "Lena Graf", email: "taken@example.ch" })).toEqual({ success: false, error: REFUSED, field: "email" });
    });

    it("checks a new email against the accounts the person may see, and saves nothing it refuses", async () => {
        mocks.taken.mockResolvedValueOnce(REFUSED);

        expect(await saveProfileAccountAction({ name: "Lena Graf", email: "gina@globex.example" })).toEqual({ success: false, error: REFUSED, field: "email" });
        expect(mocks.taken).toHaveBeenCalledWith("gina@globex.example", expect.objectContaining({ userId: "u1" }), undefined, expect.anything(), { accountId: "u1" });
        expect(mocks.updateUser).not.toHaveBeenCalled();

        // The own email in other letters is no change of the email at all.
        mocks.taken.mockClear();
        await saveProfileAccountAction({ name: "Lena Graf", email: "LENA@example.ch" });
        expect(mocks.taken).not.toHaveBeenCalled();
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
