// @vitest-environment node
import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Two sign-ups of the first account sent at the same moment, through better-auth with the guards of
 * DBackup: both pass `refuseLateSignUp` while no account exists, and only the claim in the create
 * hook of the user tells them apart. The claim lives in a store with a unique key, like the
 * `SystemSetting` table.
 */

interface Row extends Record<string, unknown> {
    id: string;
}

const state = vi.hoisted(() => ({
    db: { user: [], account: [], session: [], verification: [] } as Record<string, Row[]>,
    settings: new Map<string, { value: string; updatedAt: Date }>(),
}));

vi.mock("@/lib/prisma", () => ({
    default: {
        user: { findFirst: async () => state.db.user[0] ?? null },
        systemSetting: {
            create: async ({ data }: { data: { key: string; value: string } }) => {
                // A tick of its own, so the two sign-ups really meet at the claim.
                await new Promise((resolve) => setTimeout(resolve, 5));
                if (state.settings.has(data.key)) throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "6" });
                state.settings.set(data.key, { value: data.value, updatedAt: new Date() });
                return data;
            },
            deleteMany: async ({ where }: { where: { key: string; updatedAt: { lt: Date } } }) => {
                const row = state.settings.get(where.key);
                if (!row || row.updatedAt >= where.updatedAt.lt) return { count: 0 };
                state.settings.delete(where.key);
                return { count: 1 };
            },
        },
    },
}));

const { betterAuth } = await import("better-auth");
const { memoryAdapter } = await import("better-auth/adapters/memory");
const { createAuthMiddleware } = await import("better-auth/api");
const { claimFirstSignUp, refuseLateSignUp } = await import("@/lib/auth/sign-up-guard");

const auth = betterAuth({
    baseURL: "http://localhost:3000",
    secret: "a-secret-of-the-test-that-is-long-enough",
    logger: { disabled: true },
    database: memoryAdapter(state.db),
    emailAndPassword: { enabled: true, autoSignIn: true },
    // The two guards of src/lib/auth/index.ts.
    hooks: { before: createAuthMiddleware(async (ctx) => refuseLateSignUp(ctx.path, Boolean(ctx.request))) },
    databaseHooks: { user: { create: { before: async (user, context) => void (await claimFirstSignUp(context)) } } },
});

const signUp = (email: string) =>
    auth.handler(
        new Request("http://localhost:3000/api/auth/sign-up/email", {
            method: "POST",
            headers: { "content-type": "application/json", origin: "http://localhost:3000" },
            body: JSON.stringify({ email, password: "a-long-password-1234", name: email.split("@")[0] }),
        })
    );

describe("two first sign-ups at the same moment", () => {
    beforeEach(() => {
        for (const rows of Object.values(state.db)) rows.length = 0;
        state.settings.clear();
    });

    it("makes one account and refuses the other, so the one account becomes the platform admin", async () => {
        const answers = await Promise.all([signUp("manu@example.ch"), signUp("eve@example.ch")]);

        expect(answers.map((answer) => answer.status).sort()).toEqual([200, 403]);
        expect(state.db.user).toHaveLength(1);
        const refused = answers.find((answer) => answer.status === 403)!;
        expect(await refused.json()).toMatchObject({ code: "SIGN_UP_CLOSED" });
    });

    it("refuses a sign-up after the first account as before", async () => {
        expect((await signUp("manu@example.ch")).status).toBe(200);

        expect((await signUp("eve@example.ch")).status).toBe(403);
        expect(state.db.user).toHaveLength(1);
    });
});
