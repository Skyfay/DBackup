/**
 * New user with an email that has an account already. An account belongs to every tenant it works
 * in, so the admin of a customer must not learn through New user that an email has an account in
 * another tenant, nor try one address after the other. Whoever sees the account hears that it
 * exists, anyone else a fixed sentence that points to an invitation, and after
 * `MAX_FAILED_SIGN_UPS` such refusals within `REFUSAL_WINDOW_MS` New user refuses them every email
 * for a while, like a link of an invitation that is spent after as many.
 */

import prisma from "@/lib/prisma";
import { MAX_FAILED_SIGN_UPS } from "@/services/tenant/invitation-service";
import { membershipService } from "@/services/tenant/membership-service";
import { maySeeAccount, type AccountViewer } from "./account-visibility";

/** The answer to whoever sees the account, the platform admin included. */
export const EMAIL_HAS_ACCOUNT = "An account with this email exists already. Add it to the tenant with an invitation instead.";

/** The answer to anyone else. It reads the same whether the account exists or the email is refused for another reason. */
export const EMAIL_UNUSABLE = "This email cannot get a new account here. Send the person an invitation of the tenant instead.";

/** The answer once someone ran out of tries. */
export const EMAIL_TRIES_SPENT = "Too many emails could not get a new account. Try again in an hour, or send invitations instead.";

/** How long the refusals of one person count. */
export const REFUSAL_WINDOW_MS = 60 * 60 * 1000;

interface Tries {
    count: number;
    since: number;
}

/** Refusals per person, by the id of their account, for this process, like the failures of a link. */
const TRIES_KEY = Symbol.for("dbackup.newAccountEmailRefusals");
type TriesGlobal = typeof globalThis & { [TRIES_KEY]?: Map<string, Tries> };
function tries(): Map<string, Tries> {
    const holder = globalThis as TriesGlobal;
    holder[TRIES_KEY] ??= new Map();
    return holder[TRIES_KEY];
}

/** The refusals of a person that still count, none once the window ran out. */
function triesOf(userId: string, now: number): Tries | null {
    const entry = tries().get(userId);
    if (!entry) return null;
    if (now - entry.since >= REFUSAL_WINDOW_MS) {
        tries().delete(userId);
        return null;
    }
    return entry;
}

/**
 * Why New user of `viewer` may not make an account of this email in `tenantId`, null when the
 * email has no account and the viewer has tries left. A platform admin, and whoever sees the
 * account or finds it among the people of that tenant, hears that it exists. Anyone else hears
 * `EMAIL_UNUSABLE`, which counts as a try.
 */
export async function newAccountEmailRefusal(email: string, viewer: AccountViewer, tenantId: string, now = Date.now()): Promise<string | null> {
    const counted = viewer.isPlatformAdmin ? null : triesOf(viewer.userId, now);
    if (counted && counted.count >= MAX_FAILED_SIGN_UPS) return EMAIL_TRIES_SPENT;

    const existing = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() }, select: { id: true } });
    if (!existing) return null;
    if (viewer.isPlatformAdmin || (await maySeeAccount(viewer, existing.id)) || (await membershipService.isPersonOf(existing.id, tenantId))) {
        return EMAIL_HAS_ACCOUNT;
    }
    tries().set(viewer.userId, counted ? { ...counted, count: counted.count + 1 } : { count: 1, since: now });
    return EMAIL_UNUSABLE;
}

/** Forgets every count, for the tests. */
export function resetNewAccountEmailTries(): void {
    tries().clear();
}
