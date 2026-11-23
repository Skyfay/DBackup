/**
 * An email that has an account already, wherever an email is set: New user, the email of another
 * user, the own email under Profile and an account restored from Recently deleted under another
 * email. An account belongs to every tenant it works in, so the admin of a customer must not learn
 * through any of them that an email has an account in another tenant, nor try one address after
 * the other. Whoever sees the account hears that it exists, anyone else a fixed sentence, and after
 * `MAX_FAILED_SIGN_UPS` such refusals within `REFUSAL_WINDOW_MS`, counted across all of these
 * places and the links of an invitation they made (`email-tries.ts`), each of them refuses them
 * every email for a while, like a link of an invitation that is spent after as many.
 */

import prisma from "@/lib/prisma";
import { membershipService } from "@/services/tenant/membership-service";
import { maySeeAccount, type AccountViewer } from "./account-visibility";
import { countEmailRefusal, emailTriesSpent, resetEmailTries } from "./email-tries";

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

export { REFUSAL_WINDOW_MS } from "./email-tries";

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
    if (!viewer.isPlatformAdmin && emailTriesSpent(viewer.userId, now)) return answers.spent;

    const existing = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() }, select: { id: true } });
    if (!existing || existing.id === options.accountId) return null;
    if (viewer.isPlatformAdmin || (await maySeeAccount(viewer, existing.id)) || (tenantId !== null && (await membershipService.isPersonOf(existing.id, tenantId)))) {
        return answers.known;
    }
    countEmailRefusal(viewer.userId, now);
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
    resetEmailTries();
}
