import { Prisma } from "@prisma/client";
import { APIError } from "better-auth/api";
import prisma from "@/lib/prisma";

/**
 * Who creates an account through the sign-up of better-auth: the browser only while nobody has
 * one, for the first account of a new DBackup. Every later account comes from an admin under
 * Users & Groups, whose action signs up from the server, or from a sign-in provider that adds
 * people. An open sign-up let anyone in, and an account made with the email of someone who later
 * signed in through a provider was linked to them, with a password its maker knew.
 *
 * Two sign-ups sent at the same moment both find no account before either is made, so the create
 * hook of the user claims the first sign-up with a row of its own as well, which only one of them
 * makes, see `claimFirstSignUp`.
 */

/** The row the first sign-up from the browser makes, its value the time of the claim. */
export const FIRST_SIGN_UP_KEY = "auth.firstSignUp";

/** A claim this old that left no account behind failed before the account was made, and is free again. */
export const STALE_CLAIM_MS = 60_000;

export const SIGN_UP_CLOSED = "The first account exists already. Further accounts are made by an admin under Users & Groups.";

/** A sign-up with a password from the browser. `auth.api.signUpEmail` on the server has no request. */
export function isBrowserSignUp(path: string | undefined, fromBrowser: boolean): boolean {
    return fromBrowser && path === "/sign-up/email";
}

/** Refuses a sign-up from the browser once anyone has an account. */
export async function refuseLateSignUp(path: string | undefined, fromBrowser: boolean): Promise<void> {
    if (!isBrowserSignUp(path, fromBrowser)) return;
    if (!(await prisma.user.findFirst({ select: { id: true } }))) return;
    throw new APIError("FORBIDDEN", { code: "SIGN_UP_CLOSED", message: SIGN_UP_CLOSED });
}

const isTaken = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

/** Makes the claim, false when another sign-up holds it already. */
async function claim(): Promise<boolean> {
    try {
        await prisma.systemSetting.create({ data: { key: FIRST_SIGN_UP_KEY, value: new Date().toISOString() } });
        return true;
    } catch (error: unknown) {
        if (isTaken(error)) return false;
        throw error;
    }
}

/**
 * Runs in the create hook of a user, right before the account of a sign-up from the browser is
 * made. The first one claims the first account, and any other is refused like a late sign-up, also
 * one that passed `refuseLateSignUp` at the same time. A claim older than `STALE_CLAIM_MS` without
 * any account is taken over, so a sign-up that failed after its claim keeps no new DBackup closed.
 */
export async function claimFirstSignUp(context: { path?: string; request?: Request } | null | undefined): Promise<void> {
    if (!isBrowserSignUp(context?.path, Boolean(context?.request))) return;
    if (await claim()) return;
    const stale = !(await prisma.user.findFirst({ select: { id: true } }));
    if (stale) {
        const { count } = await prisma.systemSetting.deleteMany({ where: { key: FIRST_SIGN_UP_KEY, updatedAt: { lt: new Date(Date.now() - STALE_CLAIM_MS) } } });
        if (count > 0 && (await claim())) return;
    }
    throw new APIError("FORBIDDEN", { code: "SIGN_UP_CLOSED", message: SIGN_UP_CLOSED });
}
