// @vitest-environment node
/**
 * The length of a session against the real session handling of better-auth, with its memory
 * adapter: a session ends after the length of Settings > Sign-in, however often it is used, and its
 * cookie lasts at least as long.
 */
import { describe, expect, it } from "vitest";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { SESSION_CHOICES } from "@/components/dashboard/settings/settings-values";
import { DEFAULT_SESSION_DURATION, SESSION_DURATION_LIMITS, SESSION_OPTIONS, sessionDurationOf, sessionEndsAt } from "@/lib/auth/session-lifetime";

const HOUR = 3600;
const DAY = 24 * HOUR;

/** better-auth with the session options given and a length of one hour for every new session, like the owner set it. */
function authWith(session: Record<string, unknown>, length = HOUR) {
    const db: Record<string, Record<string, unknown>[]> = { user: [], session: [], account: [], verification: [] };
    const auth = betterAuth({
        database: memoryAdapter(db),
        secret: "session-lifetime-test-secret-0123456789",
        baseURL: "http://localhost:3000",
        emailAndPassword: { enabled: true, autoSignIn: true },
        session,
        databaseHooks: {
            session: { create: { before: async (data) => ({ data: { ...data, expiresAt: sessionEndsAt(length) } }) } },
        },
    });
    return { auth, db };
}

/** Signs up, then asks for the session twice, like two visits. Returns when the session ends then and the cookie of the sign-in. */
async function signUpAndVisit(auth: ReturnType<typeof authWith>["auth"], db: Record<string, Record<string, unknown>[]>) {
    const { headers } = await auth.api.signUpEmail({
        body: { name: "Lena Graf", email: "lena@example.ch", password: "Quartz-Lantern-7419" },
        returnHeaders: true,
    });
    const setCookie = headers.get("set-cookie") ?? "";
    const cookie = setCookie.split(";")[0];
    await auth.api.getSession({ headers: new Headers({ cookie }) });
    await auth.api.getSession({ headers: new Headers({ cookie }) });
    return { endsIn: (new Date(db.session[0].expiresAt as Date).getTime() - Date.now()) / 1000, setCookie };
}

describe("the length of a session", () => {
    it("was replaced by seven days from the last visit with the options of before", async () => {
        // The bug: better-auth extended the session to its own expiresIn on the next visit.
        const { auth, db } = authWith({ expiresIn: 7 * DAY, updateAge: DAY });
        const { endsIn } = await signUpAndVisit(auth, db);
        expect(endsIn).toBeGreaterThan(6 * DAY);
    });

    it("stays the length the owner set, however often the session is used", async () => {
        const { auth, db } = authWith(SESSION_OPTIONS);
        const { endsIn } = await signUpAndVisit(auth, db);
        expect(endsIn).toBeGreaterThan(HOUR - 60);
        expect(endsIn).toBeLessThanOrEqual(HOUR);
    });

    it("gets a cookie that lasts as long as the longest length", async () => {
        const { auth, db } = authWith(SESSION_OPTIONS, SESSION_DURATION_LIMITS.max);
        const { setCookie } = await signUpAndVisit(auth, db);
        expect(Number(/Max-Age=(\d+)/i.exec(setCookie)?.[1])).toBeGreaterThanOrEqual(SESSION_DURATION_LIMITS.max);
    });

    it("offers only lengths within the limits", () => {
        for (const seconds of SESSION_CHOICES) {
            expect(seconds).toBeGreaterThanOrEqual(SESSION_DURATION_LIMITS.min);
            expect(seconds).toBeLessThanOrEqual(SESSION_DURATION_LIMITS.max);
        }
    });

    it("falls back to seven days for a stored length that is missing or out of the limits", () => {
        expect(sessionDurationOf("3600")).toBe(3600);
        expect(sessionDurationOf(undefined)).toBe(DEFAULT_SESSION_DURATION);
        expect(sessionDurationOf("60")).toBe(DEFAULT_SESSION_DURATION);
        expect(sessionDurationOf("not a number")).toBe(DEFAULT_SESSION_DURATION);
    });
});
