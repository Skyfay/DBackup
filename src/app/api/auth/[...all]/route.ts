import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";

/**
 * The endpoints of better-auth, public on purpose: sign-in, sign-up, sign-out, the second factor,
 * passkeys and the callbacks of the sign-in providers are reached before anyone is signed in. The
 * `beforeAuth` hook in `src/lib/auth/index.ts` guards them: it refuses email sign-in when it is
 * off, a sign-up from the browser once an account exists (`sign-up-guard.ts`), a sign-in provider
 * that is off, a change of the own profile the group does not allow (`profile-guard.ts`) and a
 * password that breaks the rules (`password-guard.ts`). The `after` hook writes the sign-ins to
 * the audit log.
 */
export const { GET, POST } = toNextJsHandler(auth);
