import type { PlatformGroupShape } from "@/lib/auth/platform-group-caps";
import type { GroupActor, GroupMember } from "./groups-types";

/**
 * What the platform groups of Users & Groups under Platform show: Platform admin, built in, and the
 * groups of the people of the MSP, each with its rights on the platform, its rights in the tenants
 * and where they count. Plain data, so the browser can import it without the services behind it.
 */

/** The id the built-in group Platform admin goes by, which is `User.platformRole` and no row. */
export const PLATFORM_ADMIN_GROUP_ID = "platform-admin";

export interface PlatformGroupRow extends PlatformGroupShape {
    id: string;
    name: string;
    /** Platform admin, which holds every right, and which nobody edits or deletes. */
    builtIn: boolean;
    platformPermissions: string[];
    tenantPermissions: string[];
    tenantIds: string[];
    members: GroupMember[];
    createdAt: string;
    made: GroupActor | null;
    changed: GroupActor | null;
}

/** A tenant a platform group can reach, with what it holds, for the pick of the scope. */
export interface PlatformGroupTenant {
    id: string;
    name: string;
    isHome: boolean;
    jobs: number;
    databases: number;
}

/** Who looks at the platform groups, whose own rights cap what they give. */
export interface PlatformGroupsViewer {
    platformAdmin: boolean;
    /** What the viewer may do now, which holds their rights on the platform. */
    permissions: string[];
    /** Their own platform group, none for a platform admin or someone without one. */
    group: PlatformGroupShape | null;
    /** The id of their own platform group, which they never change themselves. */
    groupId: string | null;
}

export interface PlatformGroupsModel {
    /** Platform admin first, then the others by name. */
    groups: PlatformGroupRow[];
    /** The tenants the viewer may name: every tenant for a platform admin, the ones they may open for anyone else. */
    tenants: PlatformGroupTenant[];
    /** Every account of the instance, for "7 of 23 accounts with a platform group". */
    accounts: number;
    viewer: PlatformGroupsViewer;
}

/** What someone's platform group becomes: none, the built-in Platform admin, or one of the others by id. */
export type PlatformGroupChoice = { kind: "none" } | { kind: "admin" } | { kind: "group"; id: string };
