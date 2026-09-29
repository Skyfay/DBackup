import { AUDIT_ACTIONS as A, AUDIT_RESOURCES as R } from "./audit-types";

/**
 * How the Audit log tab groups its entries: the area of the app an entry is about, what kind of
 * thing happened, and the quick filters. Plain data, the server filters with it and the browser
 * names its filters with it.
 */

export interface AuditArea {
    id: string;
    label: string;
    /** The resources an entry of this area is written with. */
    resources: string[];
}

export const AUDIT_AREAS: AuditArea[] = [
    { id: "signin", label: "Sign-in", resources: [R.AUTH, R.SSO_PROVIDER] },
    { id: "connections", label: "Connections", resources: [R.ADAPTER, R.SOURCE] },
    { id: "jobs", label: "Jobs", resources: [R.JOB] },
    { id: "backups", label: "Backups", resources: [R.BACKUP, R.DESTINATION] },
    { id: "vault", label: "Vault", resources: [R.VAULT, R.CREDENTIAL] },
    { id: "templates", label: "Templates", resources: [R.TEMPLATE] },
    { id: "users", label: "Users", resources: [R.USER] },
    { id: "groups", label: "Groups", resources: [R.GROUP] },
    { id: "apikeys", label: "API keys", resources: [R.API_KEY] },
    { id: "settings", label: "Settings", resources: [R.SYSTEM] },
];

const AREA_OF = new Map(AUDIT_AREAS.flatMap((area) => area.resources.map((resource) => [resource, area] as const)));

/** The area of an entry, by the resource it was written with. */
export function areaOfResource(resource: string): AuditArea | null {
    return AREA_OF.get(resource) ?? null;
}

/** The resources of the areas picked in the Area filter. */
export function resourcesOfAreas(areaIds: readonly string[]): string[] {
    return AUDIT_AREAS.filter((area) => areaIds.includes(area.id)).flatMap((area) => area.resources);
}

/** Every action with how the Action filter names it, in the order it lists them. */
export const ACTION_LABELS: Record<string, string> = {
    [A.LOGIN]: "Signed in",
    [A.LOGIN_FAILED]: "Sign-in failed",
    [A.LOGOUT]: "Signed out",
    [A.CREATE]: "Created",
    [A.UPDATE]: "Changed",
    [A.DELETE]: "Deleted",
    [A.EXECUTE]: "Ran",
    [A.RESTORE]: "Restored",
    [A.EXPORT]: "Revealed or downloaded",
};

export type AuditQuick = "all" | "changes" | "signins" | "sensitive";

/** The actions each quick filter keeps. */
export const QUICK_ACTIONS: Record<Exclude<AuditQuick, "all">, string[]> = {
    changes: [A.CREATE, A.UPDATE, A.DELETE],
    signins: [A.LOGIN, A.LOGIN_FAILED, A.LOGOUT],
    // What hands out data: a revealed secret, a download, an export, a restore.
    sensitive: [A.EXPORT, A.RESTORE],
};

export const isSensitive = (action: string) => QUICK_ACTIONS.sensitive.includes(action);
