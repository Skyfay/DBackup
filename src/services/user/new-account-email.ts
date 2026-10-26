/**
 * An email that has an account already, wherever an email is set: New user, the email of another
 * user, the own email under Profile and an account restored from Recently deleted under another
 * email. An account belongs to every tenant it works in, so the admin of a customer must not learn
 * through any of them that an email has an account in another tenant, nor try one address after
 * the other. Whoever sees the account hears that it exists, anyone else a fixed sentence, and after
 * `MAX_FAILED_SIGN_UPS` such refusals within `REFUSAL_WINDOW_MS`, counted across all of these
 * places, each of them refuses them every email for a while, like a link of an invitation that is
 * spent after as many.
 */

import prisma from "@/lib/prisma";
import { MAX_FAILED_SIGN_UPS } from "@/services/tenant/invitation-service";
import { membershipService } from "@/services/tenant/membership-service";
import { maySeeAccount, type AccountViewer } from "./account-visibility";

/** The answer of New user to whoever sees the account, the platform admin included. */
export const EMAIL_HAS_ACCOUNT = "An account with this email exists already. Add it to the tenant with an invitation instead.";

/** The answer of New user to anyone else. It reads the same whether the account exists or the email is refused for another reason. */
export const EMAIL_UNUSABLE = "This email cannot get a new account here. Send the person an invitation of the tenant instead.";

/** The answer of New user once someone ran out of tries. */
export const EMAIL_TRIES_SPENT = "Too many emails could not get a new account. Try again in an hour, or send invitations instead.";

/** The answer of a change of the email of an account, or a restore under another one, to whoever sees the account that holds it. */
export const EMAIL_IN_USE = "An account with this email exists already. Pick another email.";

/** The answer of a change of the email to anyone else, also when the database refuses it as taken. */
export const EMAIL_REFUSED = "This email cannot be given to this account. Pick another email.";

/** The answer of a change of the email once someone ran out of tries. */
export const EMAIL_CHANGE_TRIES_SPENT = "Too many emails could not be given to an account. Try again in an hour.";

/** What one place that sets an email answers: to whoever may know the account, to anyone else, and once the tries are spent. */
export interface EmailAnswers {
    known: string;
    refused: string;
    spent: string;
}

/** The answers of New user. */
export const NEW_ACCOUNT_ANSWERS: EmailAnswers = { known: EMAIL_HAS_ACCOUNT, refused: EMAIL_UNUSABLE, spent: EMAIL_TRIES_SPENT };

/** The answers of a change of the email of an account and of a restore under another email. */
export const CHANGED_EMAIL_ANSWERS: EmailAnswers = { known: EMAIL_IN_USE, refused: EMAIL_REFUSED, spent: EMAIL_CHANGE_TRIES_SPENT };

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

interface TakenOptions {
    /** The account that gets the email, which may hold it already in other letters. */
    accountId?: string;
    now?: number;
}

/**
 * Why `viewer` may not give this email to an account, null when the email has no other account
 * and the viewer has tries left. A platform admin, and whoever sees the account that holds it or
 * finds it among the people of `tenantId`, hears `answers.known`. Anyone else hears
 * `answers.refused`, which counts as a try.
 */
export async function takenEmailRefusal(email: string, viewer: AccountViewer, tenantId: string | null, answers: EmailAnswers, options: TakenOptions = {}): Promise<string | null> {
    const now = options.now ?? Date.now();
    const counted = viewer.isPlatformAdmin ? null : triesOf(viewer.userId, now);
    if (counted && counted.count >= MAX_FAILED_SIGN_UPS) return answers.spent;

    const existing = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() }, select: { id: true } });
    if (!existing || existing.id === options.accountId) return null;
    if (viewer.isPlatformAdmin || (await maySeeAccount(viewer, existing.id)) || (tenantId !== null && (await membershipService.isPersonOf(existing.id, tenantId)))) {
        return answers.known;
    }
    tries().set(viewer.userId, counted ? { ...counted, count: counted.count + 1 } : { count: 1, since: now });
    return answers.refused;
}

/**
 * Why New user of `viewer` may not make an account of this email in `tenantId`, null when the
 * email has no account and the viewer has tries left, see `takenEmailRefusal`.
 */
export function newAccountEmailRefusal(email: string, viewer: AccountViewer, tenantId: string, now = Date.now()): Promise<string | null> {
    return takenEmailRefusal(email, viewer, tenantId, NEW_ACCOUNT_ANSWERS, { now });
}

/** Forgets every count, for the tests. */
export function resetNewAccountEmailTries(): void {
    tries().clear();
}
