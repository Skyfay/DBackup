import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";

const { SIGN_UP_CLOSED, refuseLateSignUp } = await import("@/lib/auth/sign-up-guard");

describe("who may create an account through the sign-up of better-auth", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        prismaMock.user.findFirst.mockResolvedValue({ id: "u1" } as never);
    });

    it("refuses a sign-up from the browser once anyone has an account", async () => {
        await expect(refuseLateSignUp("/sign-up/email", true)).rejects.toMatchObject({ body: { code: "SIGN_UP_CLOSED", message: SIGN_UP_CLOSED } });
    });

    it("lets the browser create the first account of a new DBackup", async () => {
        prismaMock.user.findFirst.mockResolvedValue(null);

        await expect(refuseLateSignUp("/sign-up/email", true)).resolves.toBeUndefined();
    });

    it("keeps New user under Users & Groups working, which signs up from the server", async () => {
        await expect(refuseLateSignUp("/sign-up/email", false)).resolves.toBeUndefined();

        expect(prismaMock.user.findFirst).not.toHaveBeenCalled();
    });

    it("leaves the sign-in and every other endpoint alone", async () => {
        await expect(refuseLateSignUp("/sign-in/email", true)).resolves.toBeUndefined();
        await expect(refuseLateSignUp(undefined, true)).resolves.toBeUndefined();

        expect(prismaMock.user.findFirst).not.toHaveBeenCalled();
    });
});
