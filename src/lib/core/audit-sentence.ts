import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "./audit-types";

/**
 * One entry of the audit log as a short sentence, like "Created the job Shop nightly" or
 * "Signed in", for the activity of a user. The entries only store an action, a resource and
 * some details, so the sentence names what those hold and stays general where they are empty.
 */

export interface AuditEntryText {
    action: string;
    resource: string;
    details: string | null;
}

/** The thing an entry is about, with its article. */
const NOUNS: Record<string, [string, string]> = {
    [AUDIT_RESOURCES.USER]: ["user", "a user"],
    [AUDIT_RESOURCES.GROUP]: ["group", "a group"],
    [AUDIT_RESOURCES.SOURCE]: ["source", "a source"],
    [AUDIT_RESOURCES.DESTINATION]: ["destination", "a destination"],
    [AUDIT_RESOURCES.JOB]: ["job", "a job"],
    [AUDIT_RESOURCES.SYSTEM]: ["setting", "a setting"],
    [AUDIT_RESOURCES.ADAPTER]: ["connection", "a connection"],
    [AUDIT_RESOURCES.VAULT]: ["key", "a key"],
    [AUDIT_RESOURCES.CREDENTIAL]: ["credential profile", "a credential profile"],
    [AUDIT_RESOURCES.API_KEY]: ["API key", "an API key"],
    [AUDIT_RESOURCES.TEMPLATE]: ["template", "a template"],
};

/** The kinds of template, which the entries of a template name in `type`. */
const TEMPLATES: Record<string, [string, string]> = {
    RetentionPolicy: ["retention policy", "a retention policy"],
    NamingTemplate: ["naming template", "a naming template"],
    SchedulePreset: ["schedule preset", "a schedule preset"],
    ExcludePatternPreset: ["exclude preset", "an exclude preset"],
    NotificationTemplate: ["notification template", "a notification template"],
};

/** What a change of a user was, as the actions write it in `change`. */
const USER_CHANGES: Record<string, string> = {
    "Password Changed": "Changed the own password",
    "Password Set": "Set a new password for a user",
    "Updating Group": "Changed the group of a user",
    "Two-Factor Reset": "Reset the second factor of a user",
    "Sessions Revoked": "Signed a user out",
};

function parse(details: string | null): Record<string, unknown> {
    if (!details) return {};
    try {
        const value: unknown = JSON.parse(details);
        return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
    } catch {
        return {};
    }
}

/** "policies" for "policy", "keys" for "key". */
const plural = (noun: string) => (/[^e]y$/.test(noun) ? `${noun.slice(0, -1)}ies` : `${noun}s`);

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);

export function auditSentence(entry: AuditEntryText): string {
    const details = parse(entry.details);
    const [noun, withArticle] = (entry.resource === AUDIT_RESOURCES.TEMPLATE && TEMPLATES[String(details.type)]) || NOUNS[entry.resource] || ["entry", "an entry"];
    const name = text(details.name);
    const object = name ? `the ${noun} ${name}` : withArticle;
    const kind = text(details.action);

    switch (entry.action) {
        case AUDIT_ACTIONS.LOGIN:
            return "Signed in";
        case AUDIT_ACTIONS.LOGOUT:
            return "Signed out";
        case AUDIT_ACTIONS.EXECUTE:
            if (kind === "file_restore") return "Restored files from a backup";
            return entry.resource === AUDIT_RESOURCES.JOB ? (name ? `Ran the job ${name}` : "Ran a job") : `Ran ${object}`;
        case AUDIT_ACTIONS.EXPORT:
            if (kind === "recovery_kit_download") return "Downloaded a recovery kit";
            if (kind === "reveal_key") return "Revealed an encryption key";
            if (kind === "file_restore_download" || kind === "download_link") return "Downloaded a backup";
            if (entry.resource === AUDIT_RESOURCES.CREDENTIAL) return name ? `Revealed the secret of ${name}` : "Revealed a secret";
            return `Exported ${object}`;
        case AUDIT_ACTIONS.CREATE:
            return `Created ${object}`;
        case AUDIT_ACTIONS.UPDATE: {
            const change = text(details.change);
            if (entry.resource === AUDIT_RESOURCES.USER && change && USER_CHANGES[change]) return USER_CHANGES[change];
            return `Changed ${object}`;
        }
        case AUDIT_ACTIONS.DELETE:
            return details.bulk === true ? `Deleted several ${plural(noun)}` : `Deleted ${object}`;
        default:
            return `${entry.action.charAt(0)}${entry.action.slice(1).toLowerCase()} ${object}`;
    }
}
