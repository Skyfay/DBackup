import { APIError } from "better-auth/api";
import prisma from "@/lib/prisma";

/**
 * Who creates an account through the sign-up of better-auth: the browser only while nobody has
 * one, for the first account of a new DBackup. Every later account comes from an admin under
 * Users & Groups, whose action signs up from the server, or from a sign-in provider that adds
 * people. An open sign-up let anyone in, and an account made with the email of someone who later
 * signed in through a provider was linked to them, with a password its maker knew.
 */

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
