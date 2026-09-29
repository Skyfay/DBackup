/**
 * What the Groups tab of the Users & Groups page shows: every group with what it lets its
 * members do and who they are, and a panel with its history. Plain data, so the browser can
 * import it without the services behind it.
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
    /** The built-in group that passes every check, which nobody edits or deletes. */
    superAdmin: boolean;
    permissions: string[];
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
    groupId: string | null;
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

export interface GroupsModel {
    groups: GroupRow[];
    stats: GroupsStats;
    /** Everyone who signs in, only for a viewer who may see the users. */
    people: GroupPerson[] | null;
    /** A SuperAdmin may move someone into the SuperAdmin group. */
    viewerSuperAdmin: boolean;
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
