// @vitest-environment node
/**
 * Turning off the authenticator app through `/two-factor/disable` of better-auth, against its real
 * endpoints with the memory adapter: a passkey that is the second factor stays one, and the sign-in
 * still asks for it. better-auth knows nothing of `passkeyTwoFactor` and set `twoFactorEnabled` off,
 * so whoever may manage the app but not the passkeys turned the passkey off with it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
    db: { user: [], account: [], session: [], verification: [], twoFactor: [] } as Record<string, Record<string, unknown>[]>,
}));

// The hook reads the account through Prisma, here the store better-auth writes to.
vi.mock("@/lib/prisma", () => ({
    default: {
        user: {
            findUnique: async ({ where }: { where: { id: string } }) => state.db.user.find((row) => row.id === where.id) ?? null,
        },
    },
}));

const { betterAuth } = await import("better-auth");
const { memoryAdapter } = await import("better-auth/adapters/memory");
const { twoFactor } = await import("better-auth/plugins");
const { keepPasskeyFactor } = await import("@/lib/auth/passkey-factor-guard");

const PASSWORD = "Quartz-Lantern-7419";

// The parts of src/lib/auth/index.ts this needs, with the same hook on the update of a user.
const auth = betterAuth({
    baseURL: "http://localhost:3000",
    secret: "passkey-factor-test-secret-0123456789",
    logger: { disabled: true },
    database: memoryAdapter(state.db),
    emailAndPassword: { enabled: true, autoSignIn: true },
    user: { additionalFields: { passkeyTwoFactor: { type: "boolean", required: false, defaultValue: false } } },
    databaseHooks: { user: { update: { before: keepPasskeyFactor } } },
    plugins: [twoFactor()],
});

/** Signs Lena up and answers the cookie of her session. */
async function signUp(): Promise<string> {
    const { headers } = await auth.api.signUpEmail({
        body: { name: "Lena Graf", email: "lena@example.ch", password: PASSWORD },
        returnHeaders: true,
    });
    return (headers.get("set-cookie") ?? "").split(";")[0];
}

/** The second factor as the switch of the passkeys and the app leave it on the account. */
function secondFactor(fields: { passkeyTwoFactor: boolean; app: boolean }) {
    const user = state.db.user[0];
    user.twoFactorEnabled = true;
    user.passkeyTwoFactor = fields.passkeyTwoFactor;
    if (fields.app) state.db.twoFactor.push({ id: "tf1", userId: user.id, secret: "s", backupCodes: "[]", verified: true });
}

async function turnOffApp(cookie: string) {
    await auth.api.disableTwoFactor({ body: { password: PASSWORD }, headers: new Headers({ cookie }) });
}

async function signIn() {
    return (await auth.api.signInEmail({ body: { email: "lena@example.ch", password: PASSWORD } })) as { twoFactorRedirect?: boolean; twoFactorMethods?: string[]; token?: string };
}

beforeEach(() => {
    for (const rows of Object.values(state.db)) rows.length = 0;
});

describe("turning off the authenticator app", () => {
    it("leaves a passkey that is the second factor on, and the sign-in asks for it", async () => {
        const cookie = await signUp();
        secondFactor({ passkeyTwoFactor: true, app: false });

        await turnOffApp(cookie);

        expect(state.db.user[0]).toMatchObject({ twoFactorEnabled: true, passkeyTwoFactor: true });
        // No code of an app is left to ask for, so the login page asks for the passkey.
        expect(await signIn()).toMatchObject({ twoFactorRedirect: true, twoFactorMethods: [] });
    });

    it("removes the app beside a passkey that is the second factor and keeps the passkey", async () => {
        const cookie = await signUp();
        secondFactor({ passkeyTwoFactor: true, app: true });

        await turnOffApp(cookie);

        expect(state.db.twoFactor).toHaveLength(0);
        expect(state.db.user[0].twoFactorEnabled).toBe(true);
        expect(await signIn()).toMatchObject({ twoFactorRedirect: true, twoFactorMethods: [] });
    });

    it("turns the second factor off when the app was the only one", async () => {
        const cookie = await signUp();
        secondFactor({ passkeyTwoFactor: false, app: true });

        await turnOffApp(cookie);

        expect(state.db.user[0].twoFactorEnabled).toBe(false);
        const signedIn = await signIn();
        expect(signedIn.twoFactorRedirect).toBeUndefined();
        expect(signedIn.token).toBeTruthy();
    });
});

describe("the hook on other updates of a user", () => {
    it("leaves every other endpoint as it is", async () => {
        const session = { user: { id: "lena" } };
        expect(await keepPasskeyFactor({ twoFactorEnabled: false }, { path: "/update-user", context: { session } })).toBeUndefined();
        expect(await keepPasskeyFactor({ name: "Lena" }, { path: "/two-factor/disable", context: { session } })).toBeUndefined();
        expect(await keepPasskeyFactor({ twoFactorEnabled: false }, null)).toBeUndefined();
    });
});

describe("the configuration of better-auth", () => {
    it("runs the hook on every update of a user", async () => {
        const { auth: configured } = await import("@/lib/auth");
        expect(configured.options.databaseHooks?.user?.update?.before).toBe(keepPasskeyFactor);
    });
});
