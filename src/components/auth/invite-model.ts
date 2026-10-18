import { loginHref } from "@/lib/auth/sign-in-target";

/**
 * The rules of the page of an invitation as plain functions: which step it shows, where its Sign in
 * leads, and which field a refusal of the server belongs to.
 */

export type InviteStepId = "gone" | "join" | "sign-in";

/** A link that does not work, a Join for someone signed in, Sign in or a new account for the rest. */
export function inviteStep(preview: { invitation: unknown | null; signedIn: unknown | null }): InviteStepId {
    if (!preview.invitation) return "gone";
    return preview.signedIn ? "join" : "sign-in";
}

/** The login page that comes back to the invitation once someone signed in, where they join with a click. */
export function inviteSignInHref(token: string): string {
    return loginHref(`/invite?token=${encodeURIComponent(token)}`);
}

/**
 * The field of the new account a refusal names, like a rule of the password or a taken email,
 * or null for one about the link itself, which shows above the form.
 */
export function refusalField(message: string): "name" | "email" | "password" | null {
    if (/password/i.test(message)) return "password";
    if (/email/i.test(message)) return "email";
    if (/\bname\b/i.test(message)) return "name";
    return null;
}
