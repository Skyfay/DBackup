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
 * says and which settings the search finds in it. A part of the open tenant, Recently deleted, is
 * a part of Settings with one tenant and of the tenant settings with more.
 */

export type SettingsPartId =
    | "general"
    | "tasks"
    | "notifications"
    | "retention"
    | "database"
    | "recently-deleted"
    | "config-backup"
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
    /**
     * Belongs to the open tenant rather than to the instance. With one tenant it is a part of
     * Settings like the others, with more it is a part of the tenant settings and the settings of
     * the instance leave it out.
     */
    tenant?: boolean;
}

/** Recently deleted, a part of Settings with one tenant and of the tenant settings with more. */
export const RECENTLY_DELETED_PART = {
    id: "recently-deleted",
    label: "Recently deleted",
    icon: ArchiveRestore,
    description: "Keys, saved logins, connections, jobs and users after a delete, for as long as Data retention keeps them. Restore one, or delete it for good.",
    tenant: true,
} as const satisfies SettingsPart;

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
            RECENTLY_DELETED_PART,
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

/** Whether a part belongs to the open tenant, which the settings of the instance leave out with more than one tenant. */
export function isTenantPart(id: string): boolean {
    return SETTINGS_PARTS.some((part) => part.id === id && part.tenant);
}

/** The groups of the Settings page, without the parts of the tenant when it does not offer them. */
export function settingsGroups(withTenantParts: boolean): SettingsGroup[] {
    if (withTenantParts) return SETTINGS_GROUPS;
    return SETTINGS_GROUPS.map((group) => ({ ...group, parts: group.parts.filter((part) => !part.tenant) })).filter((group) => group.parts.length > 0);
}

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
