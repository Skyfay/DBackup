import { PERMISSIONS } from "@/lib/auth/permissions";
import type { AllowanceKind, TenantAllowances } from "@/lib/tenant/allowances";

/**
 * Which right the form of a new record needs in its tenant, by the address the pick of a tenant
 * opens in All tenants, so New is offered only where the viewer may add that kind of record.
 */

interface NewRecordForm {
    path: string;
    /** The list of the page the form belongs to, `?tab=`, for a page of several lists. */
    tab?: string;
    permission: string;
    /** The kind of connection or the API key it adds, which the platform may not let a tenant add itself. */
    kind?: AllowanceKind;
}

const FORMS: readonly NewRecordForm[] = [
    { path: "/dashboard/jobs", permission: PERMISSIONS.JOBS.WRITE },
    { path: "/dashboard/connections", tab: "databases", permission: PERMISSIONS.SOURCES.WRITE, kind: "databases" },
    // Directory sources and destinations are both storage, so they share the right of the destinations.
    { path: "/dashboard/connections", tab: "directory-sources", permission: PERMISSIONS.DESTINATIONS.WRITE, kind: "directorySources" },
    { path: "/dashboard/connections", tab: "destinations", permission: PERMISSIONS.DESTINATIONS.WRITE, kind: "destinations" },
    { path: "/dashboard/connections", tab: "notifications", permission: PERMISSIONS.NOTIFICATIONS.WRITE, kind: "channels" },
    { path: "/dashboard/users", tab: "users", permission: PERMISSIONS.USERS.WRITE },
    { path: "/dashboard/users", tab: "apikeys", permission: PERMISSIONS.API_KEYS.WRITE, kind: "apiKeys" },
];

function formAt(href: string): NewRecordForm | undefined {
    const url = new URL(href, "http://dbackup.invalid");
    const tab = url.searchParams.get("tab");
    return FORMS.find((form) => form.path === url.pathname && (form.tab === undefined || form.tab === tab));
}

/** The right the form at an address needs, null for an address no form of a new record knows. */
export function newRecordPermission(href: string): string | null {
    return formAt(href)?.permission ?? null;
}

/** The kind of connection the form at an address adds, null for a form of anything else. */
export function newRecordKind(href: string): AllowanceKind | null {
    return formAt(href)?.kind ?? null;
}

/** A tenant as the pick of New knows it, with what the viewer may change there. */
interface CreatingTenant {
    id: string;
    /** Left out for a platform admin, who may change everything everywhere. */
    writes?: readonly string[];
    /** What the tenant may add itself, everything when left out. */
    allowances?: TenantAllowances;
}

/**
 * The tenants the viewer may add a record in with that right: every one for a platform admin,
 * the ones whose rights hold it for anyone else, none for a right nobody names.
 */
export function tenantsThatCreate<T extends CreatingTenant>(tenants: readonly T[], isPlatformAdmin: boolean, permission: string | null, kind: AllowanceKind | null = null): T[] {
    // A tenant the platform does not let add this kind of connection itself is never offered.
    const allowed = kind ? tenants.filter((tenant) => tenant.allowances?.[kind] !== false) : [...tenants];
    if (isPlatformAdmin) return allowed;
    if (!permission) return [];
    return allowed.filter((tenant) => tenant.writes?.includes(permission) === true);
}
