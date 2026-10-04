import { AUDIT_ACTIONS as A, AUDIT_RESOURCES as R } from "./audit-types";

/**
 * One entry of the audit log as a short sentence, like "Created the job Shop nightly" or "Signed
 * in with a passkey", with the names in it marked so a list can set them in bold. The entries only
 * store an action, a resource and some details, so the sentence names what those hold and stays
 * general where they are empty. The caller may pass the name of the record the entry is about when
 * the entry itself does not hold it, like a user whose password was set.
 */

export interface AuditEntryText {
    action: string;
    resource: string;
    details: string | null;
}

export interface SentencePart {
    text: string;
    /** A name, set in bold. */
    strong?: boolean;
}

export type EntryGlyph =
    | "log-in" | "log-out" | "alert" | "plus" | "copy" | "pencil" | "trash" | "play" | "restore" | "download" | "link" | "eye"
    | "lock" | "unlock" | "rotate" | "power" | "stop" | "key" | "settings";

/** What kind of entry it is, which decides its mark in a list. */
export type EntryKind = "change" | "signin" | "failed" | "sensitive" | "run";

export interface EntryDescription {
    parts: SentencePart[];
    glyph: EntryGlyph;
    kind: EntryKind;
}

/** The thing an entry is about, with its article. */
const NOUNS: Record<string, [string, string]> = {
    [R.USER]: ["user", "a user"],
    [R.GROUP]: ["group", "a group"],
    [R.SOURCE]: ["source", "a source"],
    [R.DESTINATION]: ["backup", "a backup"],
    [R.BACKUP]: ["backup", "a backup"],
    [R.JOB]: ["job", "a job"],
    [R.SYSTEM]: ["setting", "a setting"],
    [R.ADAPTER]: ["connection", "a connection"],
    [R.VAULT]: ["encryption key", "an encryption key"],
    [R.CREDENTIAL]: ["credential profile", "a credential profile"],
    [R.API_KEY]: ["API key", "an API key"],
    [R.TEMPLATE]: ["template", "a template"],
    [R.SSO_PROVIDER]: ["sign-in provider", "a sign-in provider"],
    [R.AUTH]: ["sign-in", "a sign-in"],
};

/** The kinds of template, which the entries of a template name in `type`. */
const TEMPLATES: Record<string, [string, string]> = {
    RetentionPolicy: ["retention policy", "a retention policy"],
    NamingTemplate: ["naming template", "a naming template"],
    SchedulePreset: ["schedule preset", "a schedule preset"],
    ExcludePatternPreset: ["exclude preset", "an exclude preset"],
    NotificationTemplate: ["notification template", "a notification template"],
};

/** What a change of a user was, as the actions write it in `change`, before and after the name. */
const USER_CHANGES: Record<string, [string, string]> = {
    "Password Set": ["Set a new password for", ""],
    "Updating Group": ["Changed the group of", ""],
    "Two-Factor Reset": ["Reset the second factor of", ""],
    "Sessions Revoked": ["Signed out", " everywhere"],
};

const SIGN_IN_WAYS: Record<string, string> = {
    password: "Signed in with a password",
    passkey: "Signed in with a passkey",
    "two-factor": "Signed in with a password and a second factor",
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
const count = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

/** The last part of a path, so a backup reads as its file. */
const fileName = (path: string) => path.split("/").filter(Boolean).pop() ?? path;

const plain = (value: string): SentencePart => ({ text: value });
const strong = (value: string): SentencePart => ({ text: value, strong: true });

/** "the job Shop nightly" with the name in bold, or "a job" without one. */
function object(noun: [string, string], name: string | null): SentencePart[] {
    return name ? [plain(`the ${noun[0]} `), strong(name)] : [plain(noun[1])];
}

function describe(entry: AuditEntryText, target: string | null): Omit<EntryDescription, "kind"> {
    const details = parse(entry.details);
    const noun = (entry.resource === R.TEMPLATE && TEMPLATES[String(details.type)]) || NOUNS[entry.resource] || ["entry", "an entry"];
    const file = text(details.file);
    const name = text(details.name) ?? (file ? fileName(file) : null) ?? target;
    const kind = text(details.action);
    const it = object(noun, name);

    switch (entry.action) {
        case A.LOGIN: {
            const provider = text(details.provider);
            if (details.method === "sso") return { parts: provider ? [plain("Signed in through "), strong(provider)] : [plain("Signed in through single sign-on")], glyph: "log-in" };
            return { parts: [plain(SIGN_IN_WAYS[String(details.method)] ?? "Signed in")], glyph: "log-in" };
        }
        case A.LOGIN_FAILED: {
            const email = text(details.email);
            return { parts: email ? [plain("A sign-in as "), strong(email), plain(" failed")] : [plain("A sign-in failed")], glyph: "alert" };
        }
        case A.LOGOUT:
            return { parts: [plain("Signed out")], glyph: "log-out" };
        case A.EXECUTE: {
            if (entry.resource === R.JOB) return { parts: [plain("Started "), ...it], glyph: "play" };
            if (kind === "database_vacuum") return { parts: [plain("Compacted the database of DBackup")], glyph: "play" };
            if (kind === "config_backup") return { parts: [plain("Backed up the configuration")], glyph: "play" };
            const task = text(details.task);
            if (task) return { parts: [plain("Ran the system task "), strong(task)], glyph: "play" };
            return { parts: [plain("Ran "), ...it], glyph: "play" };
        }
        case A.RESTORE: {
            if (kind === "trash_restore") return { parts: [plain("Restored "), ...it, plain(" from Recently deleted")], glyph: "restore" };
            if (kind === "config_restore") return { parts: [plain("Restored the configuration"), ...(file ? [plain(" from "), strong(fileName(file))] : [])], glyph: "restore" };
            const into = text(details.target);
            const what = kind === "file_restore" ? [plain("Restored files of "), ...(file ? [strong(fileName(file))] : [plain("a backup")])] : [plain("Restored "), ...(name ? [strong(name)] : [plain("a backup")])];
            return { parts: [...what, ...(into && kind !== "file_restore" ? [plain(" into "), strong(into)] : [])], glyph: "restore" };
        }
        case A.EXPORT: {
            if (kind === "recovery_kit_download") return { parts: [plain("Downloaded a recovery kit")], glyph: "download" };
            if (kind === "reveal_key") return { parts: [plain("Revealed "), ...it], glyph: "eye" };
            if (kind === "reveal" || entry.resource === R.CREDENTIAL) return { parts: name ? [plain("Revealed the secret of "), strong(name)] : [plain("Revealed a secret")], glyph: "eye" };
            if (kind === "database_download") return { parts: [plain("Downloaded the database of DBackup")], glyph: "download" };
            if (kind === "audit_export") return { parts: [plain("Exported the audit log")], glyph: "download" };
            if (kind === "download_link_created") return { parts: [plain("Made a download link for "), ...(name ? [strong(name)] : [plain("a backup")])], glyph: "link" };
            if (kind === "download_link") return { parts: [plain("Downloaded "), ...(name ? [strong(name)] : [plain("a backup")]), plain(" through a link")], glyph: "link" };
            if (kind === "file_restore_download") return { parts: [plain("Downloaded files of "), ...(name ? [strong(name)] : [plain("a backup")])], glyph: "download" };
            if (kind === "download") return { parts: [plain("Downloaded "), ...(name ? [strong(name)] : [plain("a backup")])], glyph: "download" };
            return { parts: [plain("Exported "), ...it], glyph: "download" };
        }
        case A.CREATE: {
            if (entry.resource === R.USER && details.via === "sso") {
                const provider = text(details.provider);
                const group = text(details.group);
                return {
                    parts: [
                        ...(provider ? [plain("Signed up through "), strong(provider)] : [plain("Signed up through single sign-on")]),
                        ...(group ? [plain(" into the group "), strong(group)] : []),
                    ],
                    glyph: "plus",
                };
            }
            const from = text(details.clonedFromName);
            return { parts: [plain("Created "), ...it, ...(from ? [plain(" as a copy of "), strong(from)] : [])], glyph: from ? "copy" : "plus" };
        }
        case A.UPDATE: {
            const change = text(details.change);
            if (entry.resource === R.USER && change === "Password Changed") return { parts: [plain("Changed the own password")], glyph: "key" };
            if (entry.resource === R.USER && change && USER_CHANGES[change]) {
                const [lead, tail] = USER_CHANGES[change];
                return { parts: [plain(`${lead} `), ...(target ? [strong(target)] : [plain("a user")]), ...(tail ? [plain(tail)] : [])], glyph: change === "Password Set" ? "key" : "pencil" };
            }
            if (change === "SSO account connected") return { parts: [plain("Linked a single sign-on account")], glyph: "link" };
            if (details.bulk === true) return { parts: [plain(`Changed ${count(details.succeeded) ?? "several"} ${plural(noun[0])}`)], glyph: "pencil" };
            if (kind === "rotate") return { parts: [plain("Rotated "), ...it], glyph: "rotate" };
            if (kind === "lock" || kind === "unlock") return { parts: [plain(kind === "lock" ? "Locked " : "Unlocked "), ...it], glyph: kind === "lock" ? "lock" : "unlock" };
            if (kind === "cancel") return { parts: [plain("Cancelled a run of "), ...it], glyph: "stop" };
            if (kind === "setDefault") return { parts: [plain("Made "), ...it, plain(" the default")], glyph: "pencil" };
            if (typeof details.enabled === "boolean" && !Array.isArray(details.changes)) return { parts: [plain(details.enabled ? "Enabled " : "Disabled "), ...it], glyph: "power" };
            const area = text(details.area);
            if (entry.resource === R.SYSTEM && area) return { parts: [plain("Changed the settings of "), strong(area)], glyph: "settings" };
            const task = text(details.task);
            if (entry.resource === R.SYSTEM && task) return { parts: [plain("Changed the system task "), strong(task)], glyph: "settings" };
            return { parts: [plain("Changed "), ...it], glyph: "pencil" };
        }
        case A.DELETE: {
            if (entry.resource === R.AUTH) return { parts: [plain("Unlinked a single sign-on account")], glyph: "trash" };
            if (kind === "trash_purge") return { parts: [plain("Removed "), ...it, plain(" from Recently deleted")], glyph: "trash" };
            // Without `permanently` a record went to Recently deleted, where it can still come back.
            const forGood = details.permanently === true ? [plain(" permanently")] : [];
            if (details.bulk === true) return { parts: [plain(`Deleted ${count(details.succeeded) ?? "several"} ${plural(noun[0])}`), ...forGood], glyph: "trash" };
            return { parts: [plain("Deleted "), ...it, ...forGood], glyph: "trash" };
        }
        default:
            return { parts: [plain(`${entry.action.charAt(0)}${entry.action.slice(1).toLowerCase()} `), ...it], glyph: "pencil" };
    }
}

function kindOf(action: string): EntryKind {
    if (action === A.LOGIN || action === A.LOGOUT) return "signin";
    if (action === A.LOGIN_FAILED) return "failed";
    if (action === A.EXPORT || action === A.RESTORE) return "sensitive";
    if (action === A.EXECUTE) return "run";
    return "change";
}

/** The entry as a sentence with its names marked, its icon and its kind. */
export function describeEntry(entry: AuditEntryText, target: string | null = null): EntryDescription {
    return { ...describe(entry, target), kind: kindOf(entry.action) };
}

/** The entry as a plain sentence, like "Created the job Shop nightly". */
export function auditSentence(entry: AuditEntryText, target: string | null = null): string {
    return describeEntry(entry, target).parts.map((part) => part.text).join("");
}
