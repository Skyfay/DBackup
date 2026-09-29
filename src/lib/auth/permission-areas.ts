import { AVAILABLE_PERMISSIONS, PERMISSIONS, type Permission } from "@/lib/auth/permissions";

/**
 * The 39 permissions as areas of the app with a level each, None, See, Use, Change or Full, and
 * one sentence per permission. The group editor sets an area by its level and shows the single
 * permissions below it, the details and cards of a group draw the level of each area. Every
 * permission belongs to exactly one area.
 */

export type Level = "none" | "see" | "use" | "change" | "full";
/** The level of an area whose permissions match none of its levels. */
export type AreaLevel = Level | "custom";

export const LEVELS: Level[] = ["none", "see", "use", "change", "full"];

export const LEVEL_LABELS: Record<AreaLevel, string> = { none: "None", see: "See", use: "Use", change: "Change", full: "Full", custom: "Custom" };

/** How many of the four dots of a level are filled. */
export const LEVEL_RANK: Record<Level, number> = { none: 0, see: 1, use: 2, change: 3, full: 4 };

export interface PermissionInfo {
    id: Permission;
    label: string;
    description: string;
    /** Ticked with it, since it does nothing without them. */
    needs?: Permission[];
    /** How a sentence names it, when the label alone does not read as what it lets one do. */
    phrase?: string;
}

export interface PermissionArea {
    id: string;
    label: string;
    /** What the levels mean in this area, like "Use: run them · Change: add and edit". */
    summary: string;
    permissions: PermissionInfo[];
    /** Each level the area has, with every permission it holds. Levels the area lacks are left out. */
    levels: Partial<Record<Exclude<Level, "none">, Permission[]>>;
}

const P = PERMISSIONS;

export const PERMISSION_AREAS: PermissionArea[] = [
    {
        id: "connections",
        label: "Connections",
        summary: "See: list them · Use: browse tables · Change: add and edit",
        permissions: [
            { id: P.SOURCES.VIEW, label: "See the databases", description: "The database connections with their status and their databases" },
            { id: P.DESTINATIONS.READ, label: "See the destinations", description: "The storage connections and what they hold" },
            { id: P.NOTIFICATIONS.READ, label: "See the notification channels", description: "The channels and what they sent" },
            { id: P.SOURCES.READ, label: "Browse databases", description: "The tables and rows of a database in the Database Explorer", needs: [P.SOURCES.VIEW] },
            { id: P.SOURCES.WRITE, label: "Change databases", description: "Add, edit and delete database connections", needs: [P.SOURCES.VIEW] },
            { id: P.DESTINATIONS.WRITE, label: "Change destinations", description: "Add, edit and delete storage connections", needs: [P.DESTINATIONS.READ] },
            { id: P.NOTIFICATIONS.WRITE, label: "Change notification channels", description: "Add, edit and delete channels", needs: [P.NOTIFICATIONS.READ] },
        ],
        levels: {
            see: [P.SOURCES.VIEW, P.DESTINATIONS.READ, P.NOTIFICATIONS.READ],
            use: [P.SOURCES.VIEW, P.DESTINATIONS.READ, P.NOTIFICATIONS.READ, P.SOURCES.READ],
            change: [P.SOURCES.VIEW, P.DESTINATIONS.READ, P.NOTIFICATIONS.READ, P.SOURCES.READ, P.SOURCES.WRITE, P.DESTINATIONS.WRITE, P.NOTIFICATIONS.WRITE],
        },
    },
    {
        id: "jobs",
        label: "Jobs",
        summary: "Use: run them · Change: add and edit",
        permissions: [
            { id: P.JOBS.READ, label: "See the jobs", description: "The jobs with their schedules and their last runs" },
            { id: P.JOBS.EXECUTE, label: "Run jobs", description: "Start a job by hand or through its API trigger", needs: [P.JOBS.READ] },
            { id: P.JOBS.WRITE, label: "Change jobs", description: "Add, edit, clone and delete jobs", needs: [P.JOBS.READ] },
        ],
        levels: {
            see: [P.JOBS.READ],
            use: [P.JOBS.READ, P.JOBS.EXECUTE],
            change: [P.JOBS.READ, P.JOBS.EXECUTE, P.JOBS.WRITE],
        },
    },
    {
        id: "backups",
        label: "Backups",
        summary: "Use: download and restore · Full: delete too",
        permissions: [
            { id: P.STORAGE.READ, label: "See the backups", description: "The Backups page, the backups of a job and their details" },
            { id: P.STORAGE.DOWNLOAD, label: "Download", description: "A backup as a file, or a link for a server", needs: [P.STORAGE.READ], phrase: "download backups" },
            { id: P.STORAGE.RESTORE, label: "Restore", description: "A backup into a database, a server or a folder", needs: [P.STORAGE.READ], phrase: "restore backups" },
            { id: P.STORAGE.DELETE, label: "Delete", description: "Backups and their copies at a destination, locked ones stay", needs: [P.STORAGE.READ], phrase: "delete backups" },
        ],
        levels: {
            see: [P.STORAGE.READ],
            use: [P.STORAGE.READ, P.STORAGE.DOWNLOAD, P.STORAGE.RESTORE],
            full: [P.STORAGE.READ, P.STORAGE.DOWNLOAD, P.STORAGE.RESTORE, P.STORAGE.DELETE],
        },
    },
    {
        id: "history",
        label: "History",
        summary: "See: runs and their logs",
        permissions: [
            { id: P.HISTORY.READ, label: "See the history", description: "Backups, restores and system tasks with their logs" },
            { id: P.DASHBOARD.READ, label: "Dashboard numbers through the API", description: "The statistics of the dashboard for scripts and monitoring", phrase: "read the dashboard numbers through the API" },
        ],
        levels: { see: [P.HISTORY.READ] },
    },
    {
        id: "templates",
        label: "Templates",
        summary: "Change: add and edit",
        permissions: [
            { id: P.TEMPLATES.READ, label: "See the templates", description: "Retention policies, file names, schedules, notifications and exclude patterns" },
            { id: P.TEMPLATES.WRITE, label: "Change templates", description: "Add, edit and delete them", needs: [P.TEMPLATES.READ] },
        ],
        levels: { see: [P.TEMPLATES.READ], change: [P.TEMPLATES.READ, P.TEMPLATES.WRITE] },
    },
    {
        id: "vault",
        label: "Vault",
        summary: "Change: add and edit · Full: reveal and delete too",
        permissions: [
            { id: P.VAULT.READ, label: "See the encryption keys", description: "The keys with the jobs and backups they protect" },
            { id: P.CREDENTIALS.READ, label: "See the credential profiles", description: "The saved logins, never their secrets" },
            { id: P.VAULT.WRITE, label: "Change encryption keys", description: "Create, import, rename and delete keys, and download recovery kits", needs: [P.VAULT.READ] },
            { id: P.CREDENTIALS.WRITE, label: "Change credential profiles", description: "Add and edit saved logins", needs: [P.CREDENTIALS.READ] },
            { id: P.CREDENTIALS.DELETE, label: "Delete credential profiles", description: "Remove saved logins that no connection uses", needs: [P.CREDENTIALS.READ] },
            { id: P.CREDENTIALS.REVEAL, label: "Reveal secrets", description: "Show the password or key of a saved login, written to the audit log", needs: [P.CREDENTIALS.READ] },
        ],
        levels: {
            see: [P.VAULT.READ, P.CREDENTIALS.READ],
            change: [P.VAULT.READ, P.CREDENTIALS.READ, P.VAULT.WRITE, P.CREDENTIALS.WRITE],
            full: [P.VAULT.READ, P.CREDENTIALS.READ, P.VAULT.WRITE, P.CREDENTIALS.WRITE, P.CREDENTIALS.DELETE, P.CREDENTIALS.REVEAL],
        },
    },
    {
        id: "users",
        label: "Users",
        summary: "Change: add people and groups",
        permissions: [
            { id: P.USERS.READ, label: "See the users", description: "Who signs in, how, and their sessions" },
            { id: P.GROUPS.READ, label: "See the groups", description: "The groups and what each lets its members do" },
            { id: P.USERS.WRITE, label: "Change users", description: "Add, edit and delete users, set passwords and end sessions", needs: [P.USERS.READ] },
            { id: P.GROUPS.WRITE, label: "Change groups", description: "Add, edit and delete groups", needs: [P.GROUPS.READ] },
        ],
        levels: {
            see: [P.USERS.READ, P.GROUPS.READ],
            change: [P.USERS.READ, P.GROUPS.READ, P.USERS.WRITE, P.GROUPS.WRITE],
        },
    },
    {
        id: "api-keys",
        label: "API keys",
        summary: "Change: make and revoke keys",
        permissions: [
            { id: P.API_KEYS.READ, label: "See the API keys", description: "The keys with their owner and when they were last used" },
            { id: P.API_KEYS.WRITE, label: "Change API keys", description: "Create, disable, rotate and delete keys", needs: [P.API_KEYS.READ] },
        ],
        levels: { see: [P.API_KEYS.READ], change: [P.API_KEYS.READ, P.API_KEYS.WRITE] },
    },
    {
        id: "audit",
        label: "Audit log",
        summary: "See: every change and sign-in",
        permissions: [{ id: P.AUDIT.READ, label: "See the audit log", description: "Every change and sign-in, with who and when" }],
        levels: { see: [P.AUDIT.READ] },
    },
    {
        id: "settings",
        label: "Settings",
        summary: "Change: the system and sign-in",
        permissions: [
            { id: P.SETTINGS.READ, label: "See the settings", description: "The system settings, the sign-in providers and the system tasks" },
            { id: P.SETTINGS.WRITE, label: "Change the settings", description: "Change them, add sign-in providers and run system tasks", needs: [P.SETTINGS.READ] },
        ],
        levels: { see: [P.SETTINGS.READ], change: [P.SETTINGS.READ, P.SETTINGS.WRITE] },
    },
    {
        id: "profile",
        label: "Own profile",
        summary: "Change: name, password and second factor",
        permissions: [
            { id: P.PROFILE.UPDATE_NAME, label: "Change the own name", description: "The name shown in DBackup and in the audit log" },
            { id: P.PROFILE.UPDATE_EMAIL, label: "Change the own email", description: "The email to sign in with" },
            { id: P.PROFILE.UPDATE_PASSWORD, label: "Change the own password", description: "Under Profile, with the current password" },
            { id: P.PROFILE.MANAGE_2FA, label: "Set up a second factor", description: "An authenticator app for the sign-in" },
            { id: P.PROFILE.MANAGE_PASSKEYS, label: "Add passkeys", description: "Sign in with a fingerprint, a face or a security key" },
            { id: P.PROFILE.MANAGE_SSO, label: "Link SSO accounts", description: "Sign in through a provider like Authentik or Keycloak" },
        ],
        levels: {
            change: [P.PROFILE.UPDATE_NAME, P.PROFILE.UPDATE_EMAIL, P.PROFILE.UPDATE_PASSWORD, P.PROFILE.MANAGE_2FA, P.PROFILE.MANAGE_PASSKEYS, P.PROFILE.MANAGE_SSO],
        },
    },
];

/** The areas the details and the cards of a group draw, without the own profile every member has. */
export const SUMMARY_AREAS = PERMISSION_AREAS.filter((area) => area.id !== "profile");

const INFO = new Map(PERMISSION_AREAS.flatMap((area) => area.permissions.map((permission) => [permission.id, { permission, area }] as const)));

export function permissionInfo(id: string): PermissionInfo | undefined {
    return INFO.get(id as Permission)?.permission;
}

/** A permission inside a sentence, like "run jobs" or "delete backups". */
export function permissionPhrase(id: string): string {
    const info = permissionInfo(id);
    if (!info) return id;
    return info.phrase ?? info.label.charAt(0).toLowerCase() + info.label.slice(1);
}

export function areaOf(id: string): PermissionArea | undefined {
    return INFO.get(id as Permission)?.area;
}

/** The levels an area offers, None first. */
export function levelsOf(area: PermissionArea): Level[] {
    return LEVELS.filter((level) => level === "none" || area.levels[level]);
}

const levelPermissions = (area: PermissionArea) => new Set(Object.values(area.levels).flat());

/**
 * The level the held permissions give an area: the level that holds exactly the permissions of
 * its levels the group has, or Custom. A permission beside the levels, like the dashboard numbers
 * of History, does not change the level, unless it is all the area holds.
 */
export function levelOf(area: PermissionArea, held: ReadonlySet<string>): AreaLevel {
    const inLevels = levelPermissions(area);
    const heldInLevels = area.permissions.filter((permission) => inLevels.has(permission.id) && held.has(permission.id)).map((permission) => permission.id);
    if (heldInLevels.length === 0) {
        return area.permissions.some((permission) => held.has(permission.id)) ? "custom" : "none";
    }
    const match = LEVELS.find((level) => {
        const set = level === "none" ? undefined : area.levels[level];
        return set !== undefined && set.length === heldInLevels.length && set.every((id) => held.has(id));
    });
    return match ?? "custom";
}

/** How many filled dots an area gets: its level, or for Custom the highest level it holds in full. */
export function rankOf(area: PermissionArea, held: ReadonlySet<string>): number {
    const level = levelOf(area, held);
    if (level !== "custom") return LEVEL_RANK[level];
    return Math.max(0, ...levelsOf(area).filter((entry) => entry !== "none" && area.levels[entry]?.every((id) => held.has(id))).map((entry) => LEVEL_RANK[entry]));
}

/** The permissions with an area set to a level. None also drops what stands beside the levels. */
export function withLevel(area: PermissionArea, held: ReadonlySet<string>, level: Level): Set<string> {
    const next = new Set(held);
    const inLevels = levelPermissions(area);
    for (const permission of area.permissions) {
        if (inLevels.has(permission.id) || level === "none") next.delete(permission.id);
    }
    if (level !== "none") for (const id of area.levels[level] ?? []) next.add(id);
    return next;
}

/** Ticks a permission with what it needs, or unticks it with what needs it. */
export function withPermission(held: ReadonlySet<string>, id: string, on: boolean): Set<string> {
    const next = new Set(held);
    const area = areaOf(id);
    if (on) {
        next.add(id);
        for (const needed of permissionInfo(id)?.needs ?? []) next.add(needed);
    } else {
        next.delete(id);
        for (const permission of area?.permissions ?? []) {
            if (permission.needs?.includes(id as Permission)) next.delete(permission.id);
        }
    }
    return next;
}

export function countIn(area: PermissionArea, held: ReadonlySet<string>): number {
    return area.permissions.filter((permission) => held.has(permission.id)).length;
}

/** Only permissions DBackup knows, in the order of the list, so a stored group holds no stale ids. */
export function knownPermissions(ids: Iterable<string>): Permission[] {
    const held = new Set(ids);
    return AVAILABLE_PERMISSIONS.filter((permission) => held.has(permission.id)).map((permission) => permission.id);
}

export interface AreaChange {
    area: PermissionArea;
    from: AreaLevel;
    to: AreaLevel;
}

/** The areas whose permissions differ, with their level before and after. */
export function areaChanges(before: ReadonlySet<string>, after: ReadonlySet<string>): AreaChange[] {
    return PERMISSION_AREAS.filter((area) => area.permissions.some((permission) => before.has(permission.id) !== after.has(permission.id))).map((area) => ({
        area,
        from: levelOf(area, before),
        to: levelOf(area, after),
    }));
}

/** "Backups See to Use", or the counts of an area whose level stays Custom. */
export function describeChange(change: AreaChange, before: ReadonlySet<string>, after: ReadonlySet<string>): string {
    if (change.from !== change.to) return `${change.area.label} ${LEVEL_LABELS[change.from]} to ${LEVEL_LABELS[change.to]}`;
    return `${change.area.label} ${countIn(change.area, before)} to ${countIn(change.area, after)} permissions`;
}
