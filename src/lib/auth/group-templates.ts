import { PERMISSIONS, type Permission } from "@/lib/auth/permissions";
import { knownPermissions } from "@/lib/auth/permission-areas";

/**
 * What a new group can start with, the first step of New group. A template only fills the
 * permissions, which the editor after it changes freely. Custom starts with none.
 */

export interface GroupTemplate {
    id: "client" | "viewer" | "operator" | "backup-admin" | "auditor" | "user-admin";
    label: string;
    /** The name the new group gets, which can change before it is created. */
    groupName: string;
    description: string;
    permissions: Permission[];
}

const P = PERMISSIONS;

/** Every member changes their own profile, unless a group takes it away. */
const OWN_PROFILE: Permission[] = Object.values(P.PROFILE);

const EVERY_READ: Permission[] = [
    P.SOURCES.VIEW, P.DESTINATIONS.READ, P.NOTIFICATIONS.READ, P.JOBS.READ, P.STORAGE.READ, P.HISTORY.READ, P.TEMPLATES.READ,
    P.VAULT.READ, P.CREDENTIALS.READ, P.USERS.READ, P.GROUPS.READ, P.API_KEYS.READ, P.AUDIT.READ, P.SETTINGS.READ,
];

export const GROUP_TEMPLATES: GroupTemplate[] = [
    {
        id: "viewer",
        label: "Viewer",
        groupName: "Viewers",
        description: "Sees everything, changes nothing, never a secret",
        permissions: knownPermissions([...EVERY_READ, ...OWN_PROFILE]),
    },
    {
        id: "operator",
        label: "Operator",
        groupName: "Operators",
        description: "Runs jobs, downloads and restores backups, changes nothing",
        permissions: knownPermissions([
            P.SOURCES.VIEW, P.DESTINATIONS.READ, P.NOTIFICATIONS.READ, P.JOBS.READ, P.JOBS.EXECUTE, P.STORAGE.READ, P.STORAGE.DOWNLOAD, P.STORAGE.RESTORE,
            P.HISTORY.READ, P.TEMPLATES.READ, ...OWN_PROFILE,
        ]),
    },
    {
        id: "backup-admin",
        label: "Backup admin",
        groupName: "Backup admins",
        description: "Everything about connections, jobs and backups, nothing about people or settings",
        permissions: knownPermissions([
            P.SOURCES.VIEW, P.SOURCES.READ, P.SOURCES.WRITE, P.DESTINATIONS.READ, P.DESTINATIONS.WRITE, P.NOTIFICATIONS.READ, P.NOTIFICATIONS.WRITE,
            P.JOBS.READ, P.JOBS.EXECUTE, P.JOBS.WRITE, P.STORAGE.READ, P.STORAGE.DOWNLOAD, P.STORAGE.RESTORE, P.STORAGE.DELETE, P.HISTORY.READ,
            P.TEMPLATES.READ, P.TEMPLATES.WRITE, P.VAULT.READ, P.CREDENTIALS.READ, ...OWN_PROFILE,
        ]),
    },
    {
        id: "auditor",
        label: "Auditor",
        groupName: "Auditors",
        description: "Reads the audit log, the history, the users and the settings, changes nothing",
        permissions: knownPermissions([
            P.AUDIT.READ, P.HISTORY.READ, P.JOBS.READ, P.STORAGE.READ, P.USERS.READ, P.GROUPS.READ, P.API_KEYS.READ, P.SETTINGS.READ, ...OWN_PROFILE,
        ]),
    },
    {
        id: "user-admin",
        label: "User admin",
        groupName: "User admins",
        description: "Manages users, groups and API keys, nothing about backups",
        permissions: knownPermissions([
            P.USERS.READ, P.USERS.WRITE, P.GROUPS.READ, P.GROUPS.WRITE, P.API_KEYS.READ, P.API_KEYS.WRITE, P.AUDIT.READ, ...OWN_PROFILE,
        ]),
    },
];

/**
 * The customer of a hosting company: sees the databases given to it and their backups, backs them up
 * on demand, downloads and restores them, and changes nothing else.
 */
export const CLIENT_TEMPLATE: GroupTemplate = {
    id: "client",
    label: "Client",
    groupName: "Client",
    description: "Sees its databases and backups, backs them up on demand, downloads and restores them",
    permissions: knownPermissions([
        P.SOURCES.VIEW, P.JOBS.READ, P.JOBS.EXECUTE, P.STORAGE.READ, P.STORAGE.DOWNLOAD, P.STORAGE.RESTORE, P.HISTORY.READ, ...OWN_PROFILE,
    ]),
};

/**
 * What a group the platform makes for tenants can start with: the customer of a hosting company
 * first, then the kinds of work of any team. The names are the ones a tenant sees, in the singular.
 */
export const TENANT_GROUP_TEMPLATES: GroupTemplate[] = [
    CLIENT_TEMPLATE,
    ...GROUP_TEMPLATES.map((template) => ({ ...template, groupName: template.label })),
];

/** A name for a new group that none of the others has, like "Operators 2". */
export function freeGroupName(name: string, taken: string[]): string {
    const names = new Set(taken.map((entry) => entry.toLowerCase()));
    if (!names.has(name.toLowerCase())) return name;
    for (let index = 2; ; index += 1) {
        const candidate = `${name} ${index}`;
        if (!names.has(candidate.toLowerCase())) return candidate;
    }
}
