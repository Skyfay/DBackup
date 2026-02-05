import { auth } from "@/lib/auth";

export const authService = {
  /**
   * Create a new user via the auth provider.
   * This handles password hashing and initial setup via Better-Auth.
   */
  async createUser(data: { name: string; email: string; password: string }) {
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
};
