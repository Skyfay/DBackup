import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock } from "@/lib/testing/prisma-mock";

const { FIRST_SIGN_UP_KEY, SIGN_UP_CLOSED, STALE_CLAIM_MS, claimFirstSignUp, refuseLateSignUp } = await import("@/lib/auth/sign-up-guard");

const taken = () => new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "6" });
const browserSignUp = { path: "/sign-up/email", request: new Request("http://localhost:3000/api/auth/sign-up/email") };

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

describe("the claim of the first account, made right before the account itself", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        prismaMock.systemSetting.create.mockResolvedValue({} as never);
        prismaMock.user.findFirst.mockResolvedValue(null);
        prismaMock.systemSetting.deleteMany.mockResolvedValue({ count: 0 });
    });

    it("lets the first sign-up from the browser claim the first account", async () => {
        await expect(claimFirstSignUp(browserSignUp)).resolves.toBeUndefined();

        expect(prismaMock.systemSetting.create).toHaveBeenCalledWith({ data: { key: FIRST_SIGN_UP_KEY, value: expect.any(String) } });
    });

    it("refuses a second sign-up sent at the same moment, which passed the check before any account existed", async () => {
        prismaMock.systemSetting.create.mockRejectedValue(taken());

        await expect(claimFirstSignUp(browserSignUp)).rejects.toMatchObject({ body: { code: "SIGN_UP_CLOSED", message: SIGN_UP_CLOSED } });
        // Only a claim older than a minute is taken over, never the one of the sign-up still running.
        expect(prismaMock.systemSetting.deleteMany).toHaveBeenCalledWith({ where: { key: FIRST_SIGN_UP_KEY, updatedAt: { lt: expect.any(Date) } } });
        const cutoff = (prismaMock.systemSetting.deleteMany.mock.calls[0][0] as { where: { updatedAt: { lt: Date } } }).where.updatedAt.lt;
        expect(Date.now() - cutoff.getTime()).toBeGreaterThanOrEqual(STALE_CLAIM_MS - 1000);
    });

    it("takes over a claim that left no account behind, so a failed sign-up keeps no new DBackup closed", async () => {
        prismaMock.systemSetting.create.mockRejectedValueOnce(taken()).mockResolvedValueOnce({} as never);
        prismaMock.systemSetting.deleteMany.mockResolvedValue({ count: 1 });

        await expect(claimFirstSignUp(browserSignUp)).resolves.toBeUndefined();
        expect(prismaMock.systemSetting.create).toHaveBeenCalledTimes(2);
    });

    it("keeps the claim while the first account exists", async () => {
        prismaMock.systemSetting.create.mockRejectedValue(taken());
        prismaMock.user.findFirst.mockResolvedValue({ id: "u1" } as never);

        await expect(claimFirstSignUp(browserSignUp)).rejects.toMatchObject({ body: { code: "SIGN_UP_CLOSED" } });
        expect(prismaMock.systemSetting.deleteMany).not.toHaveBeenCalled();
    });

    it("claims nothing for an account an admin or a provider makes", async () => {
        await claimFirstSignUp({ path: "/sign-up/email" });
        await claimFirstSignUp({ path: "/sso/callback/authentik", request: browserSignUp.request });
        await claimFirstSignUp(null);

        expect(prismaMock.systemSetting.create).not.toHaveBeenCalled();
    });

    it("passes on an error of the database that is no taken claim", async () => {
        prismaMock.systemSetting.create.mockRejectedValue(new Error("database is locked"));

        await expect(claimFirstSignUp(browserSignUp)).rejects.toThrow("database is locked");
    });
});

