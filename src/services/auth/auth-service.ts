import { auth } from "@/lib/auth";
import { ValidationError } from "@/lib/logging/errors";
import { assertPasswordAllowed } from "@/services/auth/password-policy-service";

export const authService = {
  /**
   * Create a new user via the auth provider, with a password that follows the rules of
   * Settings > Passwords. This handles password hashing and initial setup via Better-Auth.
   */
  async createUser(data: { name: string; email: string; password: string }) {
    await assertPasswordAllowed(data.password, data);
    try {
      // creating user via better-auth api
      const result = await auth.api.signUpEmail({
        body: {
          name: data.name,
          email: data.email,
          password: data.password,
        },
        // We do not pass headers, to avoid setting cookies on the current response (hopefully)
        // Or we can explicitly tell it not to sign in if supported, but signUpEmail usually signs in.
        // Since we are in a Server Action, unless we manually forward Set-Cookie headers,
        // the implicit session creation (DB side) won't affect the browser's cookie jar
        // unless better-auth magic hooks into Next.js headers() automatically.
      });
      return result;
    } catch (error: unknown) {
      // Better auth error handling
      let errorMessage = "Failed to create user";
      if (error && typeof error === 'object') {
        const err = error as { body?: { message?: string }; message?: string };
        if (err.body?.message) {
          errorMessage = err.body.message;
        } else if (err.message) {
          errorMessage = err.message;
        }
      }
      throw new Error(errorMessage);
    }
  },

  /**
   * Sets a new password for a user, the way the admin plugin of Better Auth does it: the hash
   * goes into the credential account, which is created for a user who signed in without one.
   * The password follows the rules of Settings > Passwords, which never ask less than sign-up.
   */
  async setPassword(userId: string, password: string) {
    const ctx = await auth.$context;
    const user = await ctx.internalAdapter.findUserById(userId);
    if (!user) throw new ValidationError("The user no longer exists.");
    await assertPasswordAllowed(password, user);

    const hash = await ctx.password.hash(password);
    const accounts = await ctx.internalAdapter.findAccounts(userId);
    if (accounts.some((account) => account.providerId === "credential")) {
      await ctx.internalAdapter.updatePassword(userId, hash);
    } else {
      await ctx.internalAdapter.createAccount({ userId, providerId: "credential", accountId: userId, password: hash });
    }
  },

  /** Whether a password is the one of the user, checked against the hash of their credential account. */
  async verifyPassword(userId: string, password: string): Promise<boolean> {
    const ctx = await auth.$context;
    const account = (await ctx.internalAdapter.findAccounts(userId)).find((entry) => entry.providerId === "credential");
    if (!account?.password) return false;
    return ctx.password.verify({ hash: account.password, password });
  },
};
