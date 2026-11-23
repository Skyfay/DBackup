/**
 * The rules of an invitation link in the browser: how long it works and how long its note may be,
 * like `InviteSchema` in `app/actions/tenant/invitation.ts`, and the address to hand out.
 */

/** How long a link works unless the admin picks another time. */
export const INVITE_DAYS = 7;
export const INVITE_MIN_DAYS = 1;
export const INVITE_MAX_DAYS = 30;
/** The longest note, which says who a link is for. */
export const INVITE_NOTE_MAX = 100;

/** The address to hand out, from the origin of the page and the path the action returns, like `/invite?token=...`. */
export function inviteUrl(origin: string, path: string): string {
    return `${origin.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

/** The open link that runs out first, null without any. */
export function nextToExpire<T extends { expiresAt: string }>(invitations: readonly T[]): T | null {
    return invitations.reduce<T | null>((first, invitation) => (!first || Date.parse(invitation.expiresAt) < Date.parse(first.expiresAt) ? invitation : first), null);
}

/** "1 open invitation", "3 open invitations". */
export const openInvitationsLabel = (count: number) => `${count.toLocaleString()} open ${count === 1 ? "invitation" : "invitations"}`;
