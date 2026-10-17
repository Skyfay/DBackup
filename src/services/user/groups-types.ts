/**
 * What the Groups tab of the Users & Groups page shows: every group of the tenant with what it
 * lets its members do and who they are, and a panel with its history. A group belongs to one
 * tenant. Users & Groups of the Platform lists the groups of every tenant, read only. Plain data,
 * so the browser can import it without the services behind it.
 */

/** Who did something to a group and when, as far as the audit log still knows. */
export interface GroupActor {
    at: string;
    by: string | null;
}

export interface GroupMember {
    id: string;
    name: string;
    email: string;
    image: string | null;
    isYou: boolean;
}

export interface GroupRow {
    id: string;
    name: string;
    /** The tenant it belongs to, on the list of every tenant of the Platform. Absent inside a tenant. */
    tenantId?: string;
    /** The group with every permission (`fullAccess`), which nobody edits or deletes. */
    superAdmin: boolean;
    /** A group the platform gives the tenant, which its admins give to people and only the platform changes. */
    fromPlatform: boolean;
    permissions: string[];
    /** Its members, who hold it in its tenant. */
    members: GroupMember[];
    createdAt: string;
    made: GroupActor | null;
    changed: GroupActor | null;
}

/** A user to move into a group, for Add people and Move. */
export interface GroupPerson {
    id: string;
    name: string;
    email: string;
    /** Their group in the tenant the list is for. */
    groupId: string | null;
    /** A platform admin, who sees every tenant. */
    superAdmin: boolean;
    isYou: boolean;
}

export interface GroupsStats {
    groups: number;
    people: number;
    inGroup: number;
    withoutGroup: string[];
    /** Names of the groups whose members may delete backups. */
    canDelete: string[];
    /** Names of the groups whose members may reveal secrets. */
    canReveal: string[];
    /** Names of the groups nobody is in. */
    empty: string[];
}

/** A group the platform makes for tenants, on Users & Groups of the Platform, with its group in each tenant it reaches. */
export interface TenantGroupTemplateRow {
    id: string;
    name: string;
    permissions: string[];
    /** Every tenant, the ones made later too. */
    allTenants: boolean;
    /** The tenants it reaches while it does not reach every tenant. */
    tenantIds: string[];
    /** Its group in each tenant it reaches, with who holds it there. */
    groups: { tenantId: string; groupId: string; members: GroupMember[] }[];
    createdAt: string;
    made: GroupActor | null;
    changed: GroupActor | null;
}

export interface GroupsModel {
    groups: GroupRow[];
    /** The groups the platform makes for tenants, on Users & Groups of the Platform only. */
    templates?: TenantGroupTemplateRow[];
    stats: GroupsStats;
    /** The people of the tenant the list is for, only for a viewer who may see the users. */
    people: GroupPerson[] | null;
    /** The viewer is a platform admin, who may give every group. */
    viewerPlatformAdmin: boolean;
    /** The groups of every tenant, read only, for Users & Groups of the Platform. A group is changed in its tenant. */
    allTenants: boolean;
}

export interface GroupHistoryEntry {
    id: string;
    at: string;
    by: string | null;
    /** What happened, without who, like "changed Backups See to Use". */
    text: string;
    kind: "create" | "update" | "member";
}

export interface GroupDetails {
    id: string;
    history: GroupHistoryEntry[];
    /** How many days the audit log keeps. */
    auditDays: number;
}
