import {
    ArchiveRestore,
    Bell,
    Database,
    EyeOff,
    FileCog,
    Gauge,
    History,
    KeyRound,
    ListChecks,
    Lock,
    LogIn,
    SlidersHorizontal,
    type LucideIcon,
} from "lucide-react";

/**
 * The parts of the Settings page as plain data: where each sits in the navigation, what its head
 * says and which settings the search finds in it.
 */

export type SettingsPartId =
    | "general"
    | "tasks"
    | "notifications"
    | "retention"
    | "database"
    | "config-backup"
    | "recently-deleted"
    | "sign-in"
    | "passwords"
    | "https"
    | "rate-limits"
    | "privacy";

export interface SettingsPart {
    id: SettingsPartId;
    label: string;
    /** The line under the title of the part. */
    description: string;
    icon: LucideIcon;
}

export interface SettingsGroup {
    label: string;
    parts: SettingsPart[];
}

export const SETTINGS_GROUPS: SettingsGroup[] = [
    {
        label: "System",
        parts: [
            { id: "general", label: "General", icon: SlidersHorizontal, description: "What this DBackup is called, whose clock it follows and how many runs it starts at once." },
            { id: "tasks", label: "System tasks", icon: ListChecks, description: "What DBackup does by itself, each on its schedule in the time zone of General." },
            { id: "notifications", label: "Notifications", icon: Bell, description: "Which events DBackup reports and where. Backups report per job, in the job itself." },
        ],
    },
    {
        label: "Data",
        parts: [
            { id: "retention", label: "Data retention", icon: History, description: "How long DBackup keeps its own records, cleared every night by the system task Clean old data. Backup files follow the retention of their job." },
            { id: "database", label: "Database", icon: Database, description: "The SQLite database with the configuration, the users and the history of DBackup." },
            { id: "recently-deleted", label: "Recently deleted", icon: ArchiveRestore, description: "Keys, saved logins, connections, jobs and users after a delete, for as long as Data retention keeps them. Restore one, or delete it for good." },
            { id: "config-backup", label: "Configuration backup", icon: FileCog, description: "The whole database of DBackup as one encrypted file, to rebuild it after a loss." },
        ],
    },
    {
        label: "Security",
        parts: [
            { id: "sign-in", label: "Sign-in", icon: LogIn, description: "What the login page shows, how people sign in and how long they stay signed in." },
            { id: "passwords", label: "Passwords", icon: KeyRound, description: "What a new password needs: for a new user, one an admin sets, and every change of one's own." },
            { id: "https", label: "HTTPS", icon: Lock, description: "The certificate DBackup answers with." },
            { id: "rate-limits", label: "Rate limits", icon: Gauge, description: "How many requests one address may make in a time window, against guessing and flooding." },
            { id: "privacy", label: "Privacy", icon: EyeOff, description: "What DBackup writes beside your backups, where it is not encrypted." },
        ],
    },
];

export const SETTINGS_PARTS: SettingsPart[] = SETTINGS_GROUPS.flatMap((group) => group.parts);

export function partOf(id: SettingsPartId): SettingsPart {
    return SETTINGS_PARTS.find((part) => part.id === id) ?? SETTINGS_PARTS[0];
}

/** The tabs of the page before its parts, which old links and bookmarks still open. */
const OLD_TABS: Record<string, SettingsPartId> = {
    general: "general",
    notifications: "notifications",
    tasks: "tasks",
    config: "config-backup",
    ratelimits: "rate-limits",
    certificate: "https",
    privacy: "privacy",
};

/** The part an address opens, from `?part=` or an old `?tab=`, none when it names neither. */
export function partFromAddress(part: string | null, tab: string | null): SettingsPartId | null {
    if (part && SETTINGS_PARTS.some((entry) => entry.id === part)) return part as SettingsPartId;
    if (tab && tab in OLD_TABS) return OLD_TABS[tab];
    return null;
}
