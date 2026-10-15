import { HOME_TENANT_ID } from "@/lib/tenant/home";

/**
 * The rules of the head of the sidebar, which names where the viewer works and switches the
 * tenant, as plain functions: what its two lines say, when it opens the menu, what the menu offers,
 * which page follows a switch and where the breadcrumb starts.
 */

export interface HeadTenant {
    id: string;
    name: string;
    /** Where its logo is served, null without one. */
    logo?: string | null;
}

/** What the head knows of the viewer and the instance, as the dashboard layout resolved it. */
export interface HeadInput {
    /** The tenants the viewer may open, the home tenant first. Every tenant for a platform admin. */
    tenants: readonly HeadTenant[];
    /** The tenant the viewer works in, null in All tenants. */
    activeTenantId: string | null;
    allTenants: boolean;
    isPlatformAdmin: boolean;
    /** May open All tenants: a platform admin, or a platform group that opens it. As `isPlatformAdmin` when left out. */
    opensAllTenants?: boolean;
    /** May see the tenants with their numbers and Manage tenants. As `isPlatformAdmin` when left out. */
    canSeeTenants?: boolean;
    /** May create tenants, which New tenant offers. As `isPlatformAdmin` when left out. */
    canCreateTenants?: boolean;
    /** How many tenants the instance has, also the ones the viewer may not open. */
    tenantCount: number;
    /** The name under General, which the head shows instead of DBackup. */
    instanceName?: string;
    /** The version DBackup runs, without a v. */
    version?: string;
}

export interface HeadLines {
    /** The name at 14px, like All tenants or the name of the tenant. */
    title: string;
    /** The muted line under it, like the version or Tenant 3 of 14. */
    subtitle: string | null;
    /** The head opens the menu of the tenants. Otherwise it leads to the Overview. */
    menu: boolean;
    /** The up and down arrows at the right, while there is a tenant to switch to. */
    chevrons: boolean;
    /** The logo of the tenant the head names, in place of the DBackup tile. Null for the tile. */
    logo: string | null;
}

/** The viewer may switch between two tenants or more. */
export function canSwitch(tenants: readonly unknown[]): boolean {
    return tenants.length >= 2;
}

/** "1 tenant", "14 tenants". */
function tenantsText(count: number): string {
    return `${count.toLocaleString("en-US")} ${count === 1 ? "tenant" : "tenants"}`;
}

/**
 * The two lines of the head and whether it opens the menu, per situation:
 * one tenant in the instance names DBackup or the instance with the version, All tenants counts the
 * tenants, a tenant among several names its place in the list, and someone with one tenant to open
 * in an instance of several sees their tenant with "Your backups". Whoever may see the tenants always
 * gets the menu, which holds Manage tenants, but the arrows only show with a switch to make.
 */
export function sidebarHead(input: HeadInput): HeadLines {
    const { tenants, activeTenantId, allTenants, isPlatformAdmin, tenantCount, instanceName, version } = input;
    const switchable = canSwitch(tenants);
    const menu = (input.canSeeTenants ?? isPlatformAdmin) || switchable;

    if (allTenants && switchable) {
        return { title: "All tenants", subtitle: tenantsText(Math.max(tenantCount, tenants.length)), menu, chevrons: true, logo: null };
    }

    const at = tenants.findIndex((tenant) => tenant.id === activeTenantId);
    const active = at >= 0 ? tenants[at] : null;
    if (active && switchable) {
        return { title: active.name, subtitle: `Tenant ${at + 1} of ${tenants.length}`, menu, chevrons: true, logo: active.logo ?? null };
    }
    if (active && tenantCount > 1) {
        return { title: active.name, subtitle: "Your backups", menu, chevrons: false, logo: active.logo ?? null };
    }

    // One tenant in the instance, every install before tenants: the name of the instance and its version.
    const subtitle = version ? (instanceName ? `DBackup v${version}` : `v${version}`) : null;
    return { title: instanceName || "DBackup", subtitle, menu, chevrons: switchable, logo: null };
}

/**
 * The entry All tenants heads the menu of whoever may open it, a platform admin or a platform group
 * that reaches every tenant and sees something there, once there is more than one tenant.
 */
export function offersAllTenants(opensAllTenants: boolean, tenantCount: number): boolean {
    return opensAllTenants && tenantCount > 1;
}

/** A search heads the menu once it lists more than one tenant. */
export function searchesTenants(count: number): boolean {
    return count > 1;
}

/**
 * The tenant the breadcrumb starts with, in place of Dashboard: the one the viewer works in, while
 * the instance has more than one. None in All tenants, which is no tenant.
 */
export function breadcrumbTenant(input: Pick<HeadInput, "tenants" | "activeTenantId" | "allTenants" | "tenantCount">): string | null {
    if (input.allTenants || input.tenantCount <= 1 || !input.activeTenantId) return null;
    return input.tenants.find((tenant) => tenant.id === input.activeTenantId)?.name ?? null;
}

/** "1 job · 2 databases", the line under a tenant in the menu. */
export function countLine(summary: { jobs: number; databases: number }): string {
    const count = (value: number, noun: string) => `${value.toLocaleString("en-US")} ${value === 1 ? noun : `${noun}s`}`;
    return `${count(summary.jobs, "job")} · ${count(summary.databases, "database")}`;
}

/** What the dot beside a tenant says, none while the newest backup of each job went well. */
export function healthNote(health: "failed" | "partial" | null | undefined): string | null {
    if (health === "failed") return "The newest backup of a job failed";
    if (health === "partial") return "The newest backup of a job missed a copy";
    return null;
}

/** The pages that show one record, which the next tenant does not hold. */
const RECORD_PAGES = ["/dashboard/history/run", "/dashboard/explorer/database", "/dashboard/explorer/server", "/dashboard/backups/restore"];

/** Where a switch leads: the Overview from the page of a record, the same page otherwise, as null. */
export function pageAfterSwitch(pathname: string): string | null {
    return RECORD_PAGES.some((page) => pathname === page || pathname.startsWith(`${page}/`)) ? "/dashboard" : null;
}

/** "AC" for Acme Corp, "SH" for Shop, the tile of a tenant. */
export function tenantInitials(name: string): string {
    const words = name.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return "?";
    const letters = words.length === 1 ? words[0].slice(0, 2) : words[0].charAt(0) + words[1].charAt(0);
    return letters.toUpperCase();
}

/** Whether a tenant is the home tenant, which holds what the platform owns. */
export const isHomeTenant = (id: string) => id === HOME_TENANT_ID;
