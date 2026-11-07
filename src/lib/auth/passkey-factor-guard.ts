import prisma from "@/lib/prisma";

/**
 * A passkey as the second factor (`passkeyTwoFactor`) is DBackup's own, better-auth knows only
 * `twoFactorEnabled`, which makes the sign-in ask for a second factor at all. `/two-factor/disable`
 * removes the authenticator app and sets that flag off, also while a passkey is the second factor,
 * so whoever may manage the app but not the passkeys would turn the passkey off with it. This keeps
 * the flag on while the passkey is the second factor, so the sign-in still asks for the passkey.
 * It is the mirror of `userService.togglePasskeyTwoFactor`, which keeps the flag while the app is
 * the second factor.
 */

/** The parts of the context of a database hook of better-auth this reads. */
export interface PasskeyFactorHookContext {
    path?: string;
    context?: { session?: { user?: { id?: string } | null } | null };
}

/**
 * Runs before better-auth updates a user. Answers the data that keeps `twoFactorEnabled` on when
 * `/two-factor/disable` turns it off for an account whose second factor is a passkey, and nothing
 * otherwise, which leaves the update as it is.
 */
export async function keepPasskeyFactor(
    data: Record<string, unknown>,
    context: PasskeyFactorHookContext | null | undefined
): Promise<{ data: { twoFactorEnabled: true } } | undefined> {
    if (context?.path !== "/two-factor/disable" || data.twoFactorEnabled !== false) return undefined;
    // The endpoint turns off the second factor of the account that is signed in.
    const userId = context.context?.session?.user?.id;
    if (!userId) return undefined;
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { passkeyTwoFactor: true } });
    return user?.passkeyTwoFactor ? { data: { twoFactorEnabled: true } } : undefined;
}
