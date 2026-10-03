import { AVAILABLE_PERMISSIONS, PERMISSIONS } from "@/lib/auth/permissions";

/**
 * What the permissions of a group let its members do, in words: what they see, what they do
 * besides looking, and what they change. The Users page says it for a user and for each group a
 * new user can get, so nobody has to read 39 permissions to know what a group means.
 */

interface Phrase {
    text: string;
    /** Any one of them is enough. */
    any: string[];
}

const SEES: Phrase[] = [
    { text: "the connections", any: [PERMISSIONS.SOURCES.VIEW, PERMISSIONS.DESTINATIONS.READ, PERMISSIONS.NOTIFICATIONS.READ] },
    { text: "the jobs", any: [PERMISSIONS.JOBS.READ] },
    { text: "the backups", any: [PERMISSIONS.STORAGE.READ] },
    { text: "the history", any: [PERMISSIONS.HISTORY.READ] },
    { text: "the templates", any: [PERMISSIONS.TEMPLATES.READ] },
    { text: "the Vault", any: [PERMISSIONS.VAULT.READ, PERMISSIONS.CREDENTIALS.READ] },
    { text: "the users", any: [PERMISSIONS.USERS.READ] },
    { text: "the groups", any: [PERMISSIONS.GROUPS.READ] },
    { text: "the API keys", any: [PERMISSIONS.API_KEYS.READ] },
    { text: "the audit log", any: [PERMISSIONS.AUDIT.READ] },
    { text: "the settings", any: [PERMISSIONS.SETTINGS.READ] },
];

const CHANGES: Phrase[] = [
    { text: "connections", any: [PERMISSIONS.SOURCES.WRITE, PERMISSIONS.DESTINATIONS.WRITE, PERMISSIONS.NOTIFICATIONS.WRITE] },
    { text: "jobs", any: [PERMISSIONS.JOBS.WRITE] },
    { text: "templates", any: [PERMISSIONS.TEMPLATES.WRITE] },
    { text: "the Vault", any: [PERMISSIONS.VAULT.WRITE, PERMISSIONS.CREDENTIALS.WRITE, PERMISSIONS.CREDENTIALS.DELETE] },
    { text: "users", any: [PERMISSIONS.USERS.WRITE] },
    { text: "groups", any: [PERMISSIONS.GROUPS.WRITE] },
    { text: "API keys", any: [PERMISSIONS.API_KEYS.WRITE] },
    { text: "settings", any: [PERMISSIONS.SETTINGS.WRITE] },
];

export interface AccessSummary {
    /** Everything, which only the SuperAdmin group has. */
    all: boolean;
    /** Like "the jobs", in the order of the sidebar. */
    sees: string[];
    /** Like "runs jobs" or "downloads and restores backups". */
    does: string[];
    /** Like "jobs" or "the Vault". */
    changes: string[];
    /** How many of the permissions there are the group holds. */
    count: number;
    total: number;
}

/** "a", "a and b", "a, b and c". */
export function listWords(items: string[]): string {
    if (items.length <= 1) return items[0] ?? "";
    return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Like `listWords`, but with commas only once a phrase has an "and" of its own, so none reads "runs jobs and downloads and restores". */
const joinPhrases = (phrases: string[]) => (phrases.some((phrase) => phrase.includes(" and ")) ? phrases.join(", ") : listWords(phrases));

/** The verbs of the backups, like "downloads and restores backups". */
function backupPhrase(has: (permission: string) => boolean): string | null {
    const verbs = [
        ...(has(PERMISSIONS.STORAGE.DOWNLOAD) ? ["downloads"] : []),
        ...(has(PERMISSIONS.STORAGE.RESTORE) ? ["restores"] : []),
        ...(has(PERMISSIONS.STORAGE.DELETE) ? ["deletes"] : []),
    ];
    return verbs.length > 0 ? `${listWords(verbs)} backups` : null;
}

export function summarizeAccess(permissions: readonly string[], superAdmin = false): AccessSummary {
    const total = AVAILABLE_PERMISSIONS.length;
    const held = new Set(permissions);
    const has = (permission: string) => superAdmin || held.has(permission);
    const matches = (phrase: Phrase) => phrase.any.some(has);

    const backups = backupPhrase(has);
    const does = [
        ...(has(PERMISSIONS.SOURCES.READ) ? ["browses the databases"] : []),
        ...(has(PERMISSIONS.JOBS.EXECUTE) ? ["runs jobs"] : []),
        ...(backups ? [backups] : []),
        ...(has(PERMISSIONS.CREDENTIALS.REVEAL) ? ["reveals secrets"] : []),
    ];

    return {
        all: superAdmin,
        sees: SEES.filter(matches).map((phrase) => phrase.text),
        does,
        changes: CHANGES.filter(matches).map((phrase) => phrase.text),
        count: superAdmin ? total : AVAILABLE_PERMISSIONS.filter((permission) => held.has(permission.id)).length,
        total,
    };
}

/** Only permissions of the own profile, or none at all. */
const isEmpty = (summary: AccessSummary) => summary.sees.length === 0 && summary.does.length === 0 && summary.changes.length === 0;

/** What a member sees: everything, all but a few, or the areas themselves. */
function seesText(sees: string[]): string {
    if (sees.length === SEES.length) return "sees everything";
    const missing = SEES.map((phrase) => phrase.text).filter((text) => !sees.includes(text));
    if (sees.length > 3 && missing.length <= 2) return `sees all but ${listWords(missing)}`;
    if (sees.length > 3) return `sees ${sees.length} of ${SEES.length} areas`;
    return `sees ${listWords(sees)}`;
}

/** The whole of it in up to three sentences, for the details of a user. */
export function accessSentences(summary: AccessSummary): string[] {
    if (summary.all) return ["Everything, always. A SuperAdmin passes every check."];
    if (isEmpty(summary)) return [summary.count === 0 ? "Nothing. Signs in, but sees and does nothing." : "Nothing beyond the own profile."];
    return [
        ...(summary.sees.length > 0 ? [`Sees ${summary.sees.length === SEES.length ? "everything" : listWords(summary.sees)}.`] : []),
        ...(summary.does.length > 0 ? [`${capitalize(joinPhrases(summary.does))}.`] : []),
        summary.changes.length > 0 ? `Changes ${listWords(summary.changes)}.` : "Changes nothing.",
    ];
}

/** One line for a group to pick, like "Runs jobs, downloads and restores backups, changes nothing". */
export function accessLine(summary: AccessSummary): string {
    if (summary.all) return "Everything, always";
    if (isEmpty(summary)) return summary.count === 0 ? "Nothing at all" : "Nothing beyond the own profile";
    const parts = summary.does.length > 0 ? summary.does : summary.sees.length > 0 ? [seesText(summary.sees)] : [];
    const changes = summary.changes.length > 0 ? `changes ${listWords(summary.changes)}` : "changes nothing";
    return capitalize([...parts, changes].join(", "));
}
