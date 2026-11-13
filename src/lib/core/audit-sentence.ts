import { AUDIT_ACTIONS as A, AUDIT_RESOURCES as R, SECURITY_CHANGES as S } from "./audit-types";

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
    [R.TENANT]: ["tenant", "a tenant"],
    [R.PLATFORM_GROUP]: ["platform group", "a platform group"],
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
    "Platform group set": ["Changed the platform group of", ""],
    "Made platform admin": ["Made", " a platform admin"],
    "No platform admin any more": ["Took the platform admin role from", ""],
};

/** "the own passkey Office laptop" with the name in bold, or "a passkey" without one. */
const passkeyOf = (name: string | null, own = "the own passkey "): SentencePart[] => (name ? [plain(own), strong(name)] : [plain("a passkey")]);

/** A change of the own second factor or passkeys, as the hooks of better-auth write it in `change` with the passkey in `passkey`. */
const SECURITY_SENTENCES: Record<string, (passkey: string | null) => { parts: SentencePart[]; glyph: EntryGlyph }> = {
    [S.appSetUp]: () => ({ parts: [plain("Set up an authenticator app for the own second factor")], glyph: "key" }),
    [S.on]: () => ({ parts: [plain("Turned on the own second factor")], glyph: "lock" }),
    [S.off]: () => ({ parts: [plain("Turned off the own second factor")], glyph: "unlock" }),
    [S.appRemoved]: () => ({ parts: [plain("Removed the authenticator app, a passkey stays the own second factor")], glyph: "key" }),
    [S.backupCodes]: () => ({ parts: [plain("Made new backup codes for the own second factor")], glyph: "rotate" }),
    [S.passkeyAdded]: (passkey) => ({ parts: [plain("Added "), ...passkeyOf(passkey, "the passkey "), plain(" to the own account")], glyph: "plus" }),
    [S.passkeyRenamed]: (passkey) => ({ parts: [plain("Renamed a passkey of the own account"), ...(passkey ? [plain(" to "), strong(passkey)] : [])], glyph: "pencil" }),
    [S.passkeyDeleted]: (passkey) => ({ parts: [plain("Deleted "), ...passkeyOf(passkey)], glyph: "trash" }),
    [S.sessionEnded]: () => ({ parts: [plain("Ended a session of the own account")], glyph: "log-out" }),
    [S.otherSessionsEnded]: () => ({ parts: [plain("Signed the own account out on every other device")], glyph: "log-out" }),
    [S.allSessionsEnded]: () => ({ parts: [plain("Signed the own account out everywhere")], glyph: "log-out" }),
};

/** The links that add someone to a tenant, as the actions write them in `change` with the tenant in `name`. */
const INVITATION_CHANGES: Record<string, [string, EntryGlyph]> = {
    "Invitation created": ["Made an invitation to ", "link"],
    "Invitation revoked": ["Revoked an invitation to ", "trash"],
    "Invitation accepted": ["Accepted an invitation to ", "plus"],
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

/** The names a bulk entry keeps, the first three in bold and how many more, nothing without any. */
function namesOf(value: unknown): SentencePart[] {
    const names = Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0) : [];
    if (names.length === 0) return [];
    const shown = names.slice(0, 3);
    const more = names.length - shown.length;
    return [plain(": "), strong(shown.join(", ")), ...(more > 0 ? [plain(` and ${more} more`)] : [])];
}

/**
 * An entry about the pinned SSH host key of a connection, written by `ssh-host-key-service.ts`. It
 * reads `host`, `port`, `fingerprint`, `previous`, `expected` and `presented`, all public values.
 */
function hostKeySentence(kind: string, it: SentencePart[], details: Record<string, unknown>): { parts: SentencePart[]; glyph: EntryGlyph } | null {
    const host = text(details.host);
    const at = host ? [plain(" at "), strong(typeof details.port === "number" ? `${host}:${details.port}` : host)] : [];
    const key = (value: unknown) => (text(value) ? [plain(" ("), strong(text(value)!), plain(")")] : []);
    switch (kind) {
        case "ssh-host-key.pin":
            return { parts: [plain("Pinned the SSH host key of "), ...it, ...at, ...key(details.fingerprint)], glyph: "lock" };
        case "ssh-host-key.accept":
            return { parts: [plain("Trusted a new SSH host key of "), ...it, ...at, ...key(details.fingerprint)], glyph: "key" };
        case "ssh-host-key.forget":
            return { parts: [plain("Forgot the SSH host key of "), ...it, ...at, ...key(details.previous)], glyph: "unlock" };
        case "ssh-host-key.mismatch":
            return { parts: [plain("The SSH server of "), ...it, ...at, plain(" presented another host key"), ...key(details.presented), plain(" than the pinned one, so nothing was sent to it")], glyph: "alert" };
        default:
            return null;
    }
}

/** "the job Shop nightly" with the name in bold, or "a job" without one. */
function object(noun: [string, string], name: string | null): SentencePart[] {
    return name ? [plain(`the ${noun[0]} `), strong(name)] : [plain(noun[1])];
}

function describe(entry: AuditEntryText, target: string | null): Omit<EntryDescription, "kind"> {
    const details = parse(entry.details);
    const noun = (entry.resource === R.TEMPLATE && TEMPLATES[String(details.type)])
        || (entry.resource === R.GROUP && details.forTenants === true && ["group for tenants", "a group for tenants"] as [string, string])
        || NOUNS[entry.resource] || ["entry", "an entry"];
    const file = text(details.file);
    const name = text(details.name) ?? (file ? fileName(file) : null) ?? target;
    const kind = text(details.action);
    const it = object(noun, name);

    // An invitation is about a tenant but changes none, so it never reads as a tenant created or deleted.
    const invitation = entry.resource === R.TENANT ? INVITATION_CHANGES[String(details.change)] : undefined;
    if (invitation) return { parts: [plain(invitation[0]), ...(name ? [strong(name)] : [plain("a tenant")])], glyph: invitation[1] };

    // The pinned SSH host key of a connection: pinned on a first login, trusted or forgotten on purpose, or refused.
    const hostKey = kind?.startsWith("ssh-host-key.") ? hostKeySentence(kind, it, details) : null;
    if (hostKey) return hostKey;

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
            // A backup a customer started of a database given to it: in its own log the database, in
            // the log of the server's tenant the job, the database and the customer.
            if (kind === "backup_on_demand") {
                const database = text(details.database);
                const customer = text(details.tenant);
                if (entry.resource === R.JOB) {
                    return { parts: [plain("Started "), ...it, ...(database ? [plain(" for "), strong(database)] : []), ...(customer ? [plain(" of "), strong(customer)] : [])], glyph: "play" };
                }
                return { parts: [plain("Started a backup of "), ...(name ? [strong(name)] : [plain("a shared database")])], glyph: "play" };
            }
            if (entry.resource === R.JOB) return { parts: [plain("Started "), ...it], glyph: "play" };
            // A check of the copies of a backup against their checksums, which changes nothing of them.
            if (kind === "verify") return { parts: [plain("Checked "), ...it], glyph: "eye" };
            if (kind === "notification_test") return { parts: [plain("Sent a test of "), ...(name ? [strong(name)] : [plain("a notification")])], glyph: "play" };
            if (kind === "recipients_test") return { parts: [plain("Sent a test to the own recipients of "), ...it], glyph: "play" };
            if (kind === "connection_test") return { parts: [plain("Tested "), ...(name ? it : [plain("a new connection")])], glyph: "play" };
            if (kind === "ssh_test") {
                const host = text(details.host);
                return { parts: [plain("Tested the SSH login to "), ...(host ? [strong(host)] : [plain("a server")])], glyph: "play" };
            }
            // A look at a server a picker or a connection form took with its login.
            if (kind === "folder_browse") {
                const host = text(details.host);
                const where = name ? it : host ? [strong(host)] : details.local === true ? [plain("the server DBackup runs on")] : [plain("a connection")];
                return { parts: [plain("Browsed the folders of "), ...where], glyph: "eye" };
            }
            if (kind === "snapshot_check") {
                const host = text(details.host);
                return { parts: [plain("Checked the snapshots of "), ...(host ? [strong(host)] : [plain("a server")])], glyph: "play" };
            }
            if (kind === "volume_list") return { parts: [plain("Listed the Docker volumes of "), ...it], glyph: "eye" };
            if (kind === "volume_sizes") return { parts: [plain("Measured the Docker volumes of "), ...it], glyph: "eye" };
            if (kind === "path_check") {
                const folder = text(details.path);
                return { parts: [plain("Checked whether "), ...(folder ? [plain("the folder "), strong(folder)] : [plain("the top folder")]), plain(" of "), ...it, plain(" holds files")], glyph: "eye" };
            }
            if (kind === "token_check") return { parts: [plain("Checked the authorization of "), ...it], glyph: "eye" };
            if (kind === "sso_check") {
                const host = text(details.host);
                return { parts: [plain("Checked the sign-in provider at "), ...(host ? [strong(host)] : [plain("an address")])], glyph: "eye" };
            }
            // A key tried on a backup that changed nothing in the Vault, never the key itself.
            if (kind === "key_check") {
                const destination = text(details.destination);
                const keyName = text(details.keyName);
                return {
                    parts: [
                        plain("Tried a key on "), ...(file ? [strong(fileName(file))] : [plain("a backup")]),
                        ...(destination ? [plain(" at "), strong(destination)] : []),
                        ...(details.success === false ? [plain(", it did not open it")] : keyName ? [plain(", it is the key "), strong(keyName)] : []),
                    ],
                    glyph: "key",
                };
            }
            if (kind === "storage_check") return { parts: [plain("Listed the backups at the destinations again"), ...namesOf(details.names)], glyph: "eye" };
            if (kind === "databases_read") {
                const count = typeof details.count === "number" ? details.count : null;
                const which = name ? [plain("the source "), strong(name)]
                    : details.form === true ? [plain("a new connection")]
                    : details.all === true ? [plain("every source")]
                    : [plain(count === null ? "some sources" : `${count} sources`)];
                return { parts: [plain("Read the databases of "), ...which], glyph: "play" };
            }
            if (kind === "database_vacuum") return { parts: [plain("Compacted the database of DBackup")], glyph: "play" };
            if (kind === "config_backup") return { parts: [plain("Backed up the configuration")], glyph: "play" };
            const task = text(details.task);
            if (task) return { parts: [plain("Ran the system task "), strong(task)], glyph: "play" };
            return { parts: [plain("Ran "), ...it], glyph: "play" };
        }
        case A.RESTORE: {
            // A customer's restore of a database on a shared server, in the log of the server's tenant.
            if (kind === "shared_restore") {
                const server = text(details.server);
                const customer = text(details.tenant);
                return {
                    parts: [
                        plain("Restored "), ...(name ? [strong(name)] : [plain("a shared database")]),
                        ...(server ? [plain(" on "), strong(server)] : []), ...(customer ? [plain(" for "), strong(customer)] : []),
                    ],
                    glyph: "restore",
                };
            }
            if (kind === "trash_restore") return { parts: [plain("Restored "), ...it, plain(" from Recently deleted")], glyph: "restore" };
            if (kind === "config_restore") return { parts: [plain("Restored the configuration"), ...(file ? [plain(" from "), strong(fileName(file))] : [])], glyph: "restore" };
            const into = text(details.target);
            const what = kind === "file_restore" ? [plain("Restored files of "), ...(file ? [strong(fileName(file))] : [plain("a backup")])] : [plain("Restored "), ...(name ? [strong(name)] : [plain("a backup")])];
            // The customers whose databases on a shared server the restore overwrote.
            const customers = Array.isArray(details.customers) ? details.customers.filter((entry): entry is string => typeof entry === "string" && entry.length > 0) : [];
            return {
                parts: [
                    ...what, ...(into && kind !== "file_restore" ? [plain(" into "), strong(into)] : []),
                    ...(customers.length > 0 ? [plain(customers.length === 1 ? ", over databases of the customer " : ", over databases of the customers "), strong(customers.join(", "))] : []),
                ],
                glyph: "restore",
            };
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
            // A customer's download of a database of a shared server, in the log of the server's tenant.
            if (kind === "shared_download") {
                const server = text(details.server);
                const customer = text(details.tenant);
                return {
                    parts: [
                        plain("Downloaded "), ...(name ? [strong(name)] : [plain("a shared database")]),
                        ...(server ? [plain(" of "), strong(server)] : []), ...(customer ? [plain(" for "), strong(customer)] : []),
                    ],
                    glyph: "download",
                };
            }
            if (kind === "download") return { parts: [plain("Downloaded "), ...(name ? [strong(name)] : [plain("a backup")])], glyph: "download" };
            // What the Database Explorer read of a database: its tables, or the rows of one.
            if (kind === "table_list" || kind === "table_data") {
                const database = text(details.database);
                const table = text(details.table);
                const what = kind === "table_data"
                    ? [plain("Read the rows of "), ...(table ? [strong(table)] : [plain("a table")])]
                    : [plain("Listed the tables")];
                return {
                    parts: [...what, ...(database ? [plain(" of "), strong(database)] : []), ...(name ? [plain(" on "), strong(name)] : [])],
                    glyph: "eye",
                };
            }
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
            // An account that signed in through the provider of a tenant for the first time, see sso-tenant-guard.ts.
            if (entry.resource === R.USER && change === "Joined through single sign-on") {
                const provider = text(details.provider);
                const group = text(details.group);
                return {
                    parts: [plain("Joined through "), provider ? strong(provider) : plain("single sign-on"), ...(group ? [plain(" into the group "), strong(group)] : [])],
                    glyph: "plus",
                };
            }
            if (entry.resource === R.USER && change && SECURITY_SENTENCES[change]) return SECURITY_SENTENCES[change](text(details.passkey));
            if (entry.resource === R.USER && change && USER_CHANGES[change]) {
                const [lead, tail] = USER_CHANGES[change];
                // The group a change of the group gave, which the entry names since the version that wrote it.
                const given = change === "Updating Group" ? text(details.group) : null;
                return {
                    parts: [plain(`${lead} `), ...(name ? [strong(name)] : [plain("a user")]), ...(tail ? [plain(tail)] : []), ...(given ? [plain(" to "), strong(given)] : [])],
                    glyph: change === "Password Set" ? "key" : "pencil",
                };
            }
            if (change === "SSO account connected") return { parts: [plain("Linked a single sign-on account")], glyph: "link" };
            // A destination or a channel shared with other tenants, see src/services/sharing/.
            const tenants = text(details.tenants);
            if (kind === "share") return { parts: [plain("Shared "), ...it, plain(tenants ? ` with ${tenants}` : " with other tenants")], glyph: "link" };
            if (kind === "unshare") return { parts: [plain("Stopped sharing "), ...it, ...(tenants ? [plain(` with ${tenants}`)] : [])], glyph: "link" };
            if (kind === "shareTerms") return { parts: [plain("Changed the sharing terms of "), ...it], glyph: "link" };
            if (kind === "recipients") return { parts: [plain("Changed the recipients of "), ...it], glyph: "pencil" };
            if (details.bulk === true) return { parts: [plain(`Changed ${count(details.succeeded) ?? "several"} ${plural(noun[0])}`), ...namesOf(details.names)], glyph: "pencil" };
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
            if (entry.resource === R.AUTH) return { parts: name ? [plain("Unlinked the sign-in through "), strong(name)] : [plain("Unlinked a single sign-on account")], glyph: "trash" };
            if (kind === "trash_purge") return { parts: [plain("Removed "), ...it, plain(" from Recently deleted")], glyph: "trash" };
            // Without `permanently` a record went to Recently deleted, where it can still come back.
            const forGood = details.permanently === true ? [plain(" permanently")] : [];
            if (details.bulk === true) return { parts: [plain(`Deleted ${count(details.succeeded) ?? "several"} ${plural(noun[0])}`), ...forGood, ...namesOf(details.names)], glyph: "trash" };
            // The backups of a customer on a destination its tenant shares with it.
            const customer = text(details.tenant);
            if (kind === "tenantBackups") return { parts: [plain("Deleted the backups of "), ...(customer ? [strong(customer)] : [plain("a tenant")]), plain(" on "), ...it], glyph: "trash" };
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
