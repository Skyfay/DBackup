import { DATA_RETENTION_SETTINGS } from "@/lib/core/data-retention";
import { SETTINGS_PARTS, type SettingsPartId } from "./settings-parts";

/**
 * Every setting the search of the Settings page finds, in the words of its part. A result opens
 * its part and marks the row whose `data-setting` is its id, a task opens its Edit dialog.
 */

export interface SettingEntry {
    part: SettingsPartId;
    /** `data-setting` of its row, `task:<id>` for a task, `event:<id>` for a notification event, or the id of the part for the part itself. */
    id: string;
    label: string;
    text: string;
}

const SETTINGS: SettingEntry[] = [
    { part: "general", id: "general.name", label: "Name", text: "The name in the browser tab, like DBackup | Production." },
    { part: "general", id: "general.timezone", label: "Time zone", text: "Schedules, file names, the retention and the dashboard follow it." },
    { part: "general", id: "general.runs", label: "Runs at the same time", text: "Backups, restores and integrity checks share them." },
    { part: "general", id: "general.stuck", label: "Fail a run that stops reporting after", text: "The system task Stuck run watchdog follows it." },
    { part: "general", id: "general.updates", label: "Look for new versions", text: "Asks GitHub for the newest release and shows it in the sidebar." },
    { part: "general", id: "general.quick-setup", label: "Show Quick Setup in the sidebar", text: "It shows by itself while no database is set up." },
    { part: "notifications", id: "notifications.events", label: "Default channels", text: "Where every event goes unless it has channels of its own." },
    ...DATA_RETENTION_SETTINGS.map((setting): SettingEntry => ({ part: "retention", id: `retention.${setting.id}`, label: setting.label, text: setting.description })),
    { part: "database", id: "database.optimize", label: "Optimize", text: "Rebuilds the database file without its unused space." },
    { part: "database", id: "database.download", label: "Download the database", text: "A copy of the whole database, only for a SuperAdmin." },
    { part: "config-backup", id: "config.enabled", label: "Back up the configuration", text: "On its schedule, to its destination." },
    { part: "config-backup", id: "config.destination", label: "Destination", text: "Where the configuration backup goes." },
    { part: "config-backup", id: "config.key", label: "Encryption key", text: "The key the configuration backup is encrypted with." },
    { part: "config-backup", id: "config.schedule", label: "Schedule", text: "When the configuration backup runs." },
    { part: "config-backup", id: "config.keeps", label: "Keeps", text: "How many configuration backups stay at the destination." },
    { part: "config-backup", id: "config.secrets", label: "Include the logins", text: "Passwords and keys of every connection, only encrypted." },
    { part: "config-backup", id: "config.history", label: "Include the history", text: "Runs, logs, the audit log and the storage history." },
    { part: "config-backup", id: "config.restore", label: "Restore from a file", text: "Brings back connections, jobs, users and settings, only for a SuperAdmin." },
    { part: "sign-in", id: "signin.sessions", label: "Sessions last", text: "How long someone stays signed in." },
    { part: "sign-in", id: "signin.passkey", label: "Sign in with a passkey", text: "The passkey button on the login page." },
    { part: "sign-in", id: "signin.password", label: "Sign in with a password", text: "DISABLE_EMAIL_LOGIN on the container turns it off." },
    { part: "sign-in", id: "signin.providers", label: "Sign-in providers", text: "OpenID Connect providers like Authentik, under Users & Groups." },
    { part: "https", id: "https.certificate", label: "Certificate", text: "Who it is issued to, until when it is valid, its SHA-256 and its names." },
    { part: "https", id: "https.upload", label: "Upload certificate", text: "Your own certificate and its private key." },
    { part: "https", id: "https.self-signed", label: "Make a new self-signed one", text: "A new self-signed certificate for a year." },
    { part: "rate-limits", id: "rate.auth", label: "Sign-ins", text: "Slows down guessing passwords on the login page." },
    { part: "rate-limits", id: "rate.api", label: "Reads through the API", text: "Every GET to /api, from the browser and from API keys." },
    { part: "rate-limits", id: "rate.mutation", label: "Changes through the API", text: "Every POST, PUT and DELETE to /api." },
    { part: "privacy", id: "privacy.actor", label: "Name who started a backup in its metadata", text: "The .meta.json beside each backup, which is not encrypted." },
];

type Named = { id: string; name: string; description: string };

/** The settings with the tasks and the notification events, which the page knows only from its model, and the parts themselves. */
export function settingsIndex(tasks: Named[], events: Named[] = []): SettingEntry[] {
    return [
        ...SETTINGS_PARTS.map((part): SettingEntry => ({ part: part.id, id: part.id, label: part.label, text: part.description })),
        ...SETTINGS,
        ...tasks.map((task): SettingEntry => ({ part: "tasks", id: `task:${task.id}`, label: task.name, text: task.description })),
        ...events.map((event): SettingEntry => ({ part: "notifications", id: `event:${event.id}`, label: event.name, text: event.description })),
    ];
}

export interface SettingsSearch {
    hits: SettingEntry[];
    /** Hits per part, for the navigation. */
    counts: Partial<Record<SettingsPartId, number>>;
}

/** The words of a text or a search, in lower case. */
export function wordsOf(text: string): string[] {
    return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/**
 * The entries in whose name or line every word of the search starts a word, regardless of case,
 * in the order of the page. Starts only, so backup finds backups but not every DBackup.
 */
export function searchSettings(index: SettingEntry[], term: string): SettingsSearch {
    const terms = wordsOf(term);
    const counts: Partial<Record<SettingsPartId, number>> = {};
    if (terms.length === 0) return { hits: [], counts };
    const order = new Map(SETTINGS_PARTS.map((part, position) => [part.id, position]));
    const hits = index
        .filter((entry) => {
            const words = wordsOf(`${entry.label} ${entry.text}`);
            return terms.every((word) => words.some((candidate) => candidate.startsWith(word)));
        })
        .sort((a, b) => (order.get(a.part) ?? 0) - (order.get(b.part) ?? 0));
    for (const hit of hits) counts[hit.part] = (counts[hit.part] ?? 0) + 1;
    return { hits, counts };
}
