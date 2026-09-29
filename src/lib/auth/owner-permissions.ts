import { AVAILABLE_PERMISSIONS } from "@/lib/auth/permissions";

/**
 * What a user may do by their group: every permission for the SuperAdmin group, the stored ones
 * DBackup knows for any other group, and nothing without a group. An API key never does more than
 * its owner may, so this is the ceiling of every key.
 */

const SUPER_ADMIN_GROUP = "SuperAdmin";

export interface OwnerGroup {
    name: string;
    /** As stored, a JSON list. */
    permissions: string;
}

export function groupPermissions(group: OwnerGroup | null | undefined): string[] {
    if (!group) return [];
    if (group.name === SUPER_ADMIN_GROUP) return AVAILABLE_PERMISSIONS.map((permission) => permission.id);
    let stored: unknown;
    try {
        stored = JSON.parse(group.permissions);
    } catch {
        return [];
    }
    const held = new Set(Array.isArray(stored) ? stored.filter((entry): entry is string => typeof entry === "string") : []);
    return AVAILABLE_PERMISSIONS.filter((permission) => held.has(permission.id)).map((permission) => permission.id);
}

/** The permissions of a key its owner may use right now. What the group of the owner lost stays stored but does nothing. */
export function capToOwner(keyPermissions: readonly string[], ownerGroup: OwnerGroup | null | undefined): string[] {
    const allowed = new Set(groupPermissions(ownerGroup));
    return keyPermissions.filter((permission) => allowed.has(permission));
}
