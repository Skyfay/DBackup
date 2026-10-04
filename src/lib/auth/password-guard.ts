import { APIError } from "better-auth/api";
import { passwordProblem, type PasswordOwner } from "@/lib/auth/password-policy";
import { getPasswordPolicy } from "@/services/auth/password-policy-service";

/**
 * The endpoints of better-auth that set a password, with the field of the new one. The browser
 * calls sign-up and change-password itself, so the rules of Settings > Passwords are checked here
 * and not only in the actions of DBackup.
 */
const PASSWORD_FIELDS: Readonly<Record<string, "password" | "newPassword">> = {
    "/sign-up/email": "password",
    "/change-password": "newPassword",
    "/set-password": "newPassword",
    "/reset-password": "newPassword",
};

/** The parts of the context of a better-auth hook the check reads. */
export interface PasswordHookContext {
    path?: string;
    body?: unknown;
}

const text = (value: unknown) => (typeof value === "string" ? value : null);

/**
 * Refuses a new password that breaks a rule before better-auth stores it. A sign-up names its
 * owner in the body, a change of a password belongs to whoever is signed in.
 */
export async function refuseWeakPassword(ctx: PasswordHookContext, signedIn: () => Promise<{ user: PasswordOwner } | null>): Promise<void> {
    const field = ctx.path ? PASSWORD_FIELDS[ctx.path] : undefined;
    if (!field || !ctx.body || typeof ctx.body !== "object") return;
    const body = ctx.body as Record<string, unknown>;
    // Anything but text is refused by better-auth itself.
    const password = text(body[field]);
    if (password === null) return;

    const owner: PasswordOwner = ctx.path === "/sign-up/email" ? { name: text(body.name), email: text(body.email) } : (await signedIn())?.user ?? {};
    const problem = passwordProblem(password, await getPasswordPolicy(), owner);
    if (problem) throw new APIError("BAD_REQUEST", { code: "PASSWORD_POLICY", message: problem });
}
