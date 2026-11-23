import { keepPasskeyFactor, type PasskeyFactorHookContext } from "./passkey-factor-guard";

/**
 * The hook of every change better-auth makes to a user, `databaseHooks.user.update.before`.
 *
 * `User.emailVerified` is a flag of DBackup: it says whether an admin or a provider set the email,
 * and a sign-in provider links an account by its email only while it is true, see
 * `allowTenantSsoLink`. DBackup writes it itself, through Prisma and past these hooks. better-auth
 * sets it true on its own, at a sign-in of an identity that is linked already whose provider calls
 * the email of the account verified, and after a link. An account whose owner picked its email
 * would then be linked by that email for another identity, so a change of better-auth never sets
 * the flag. Setting it false, like DBackup does, is left alone.
 */
export async function beforeUserUpdate(
    data: Record<string, unknown>,
    context: PasskeyFactorHookContext | null | undefined
): Promise<{ data: Record<string, unknown> } | undefined> {
    // A value of undefined leaves the column as it is, the hook can only add to the change.
    const flag = data.emailVerified === true ? { emailVerified: undefined } : null;
    const factor = await keepPasskeyFactor(data, context);
    if (!flag && !factor) return undefined;
    return { data: { ...flag, ...factor?.data } };
}
