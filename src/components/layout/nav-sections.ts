import {
    Archive,
    Building2,
    CalendarClock,
    Database,
    History,
    LayoutDashboard,
    LayoutTemplate,
    Lock,
    Rocket,
    SearchCode,
    Settings,
    SlidersHorizontal,
    UserCog,
    Users,
    type LucideIcon,
} from "lucide-react";
import { PERMISSIONS } from "@/lib/auth/permissions";

/**
 * The sections of the sidebar as plain data and the rules of which show, so the sidebar, the
 * search of pages and the tests read the same list. With one tenant the sidebar is the one of
 * every install before tenants. With more, Administration is about the open tenant and a section
 * Platform below it holds what decides over every tenant, each entry for whoever holds its right
 * on the platform: a platform admin, or someone of a platform group that gives it.
 */

export interface NavItem {
    icon: LucideIcon;
    label: string;
    href: string;
    /** Any of them shows the entry. A platform admin sees every entry of the sections they get. */
    permission?: string | string[];
    quickSetupOnly?: boolean;
}

export interface NavGroup {
    label: string;
    items: NavItem[];
    /** The section Platform, which the sidebar sets apart at its foot. */
    platform?: boolean;
}

/** What decides the sections: the instance, the viewer and where they work. */
export interface NavState {
    /** How many tenants the instance has, also the ones the viewer may not open. */
    tenantCount: number;
    isPlatformAdmin: boolean;
    /** A platform admin looks at every tenant at once. */
    allTenants?: boolean;
    showQuickSetup?: boolean;
}

const P = PERMISSIONS;

export const OVERVIEW: NavItem = { icon: LayoutDashboard, label: "Overview", href: "/dashboard" };
export const QUICK_SETUP: NavItem = { icon: Rocket, label: "Quick Setup", href: "/dashboard/setup", permission: [P.SOURCES.WRITE, P.DESTINATIONS.WRITE, P.JOBS.WRITE], quickSetupOnly: true };

// Databases, storage in either role, and notification channels all live under one entry, they
// are the same kind of thing (something DBackup connects to) and only differ in what they connect to.
const CONNECTIONS: NavItem = { icon: Database, label: "Connections", href: "/dashboard/connections", permission: [P.SOURCES.VIEW, P.DESTINATIONS.READ, P.NOTIFICATIONS.READ] };
const JOBS: NavItem = { icon: CalendarClock, label: "Jobs", href: "/dashboard/jobs", permission: P.JOBS.READ };
// What the jobs made, beside the jobs: every backup and where it lies.
const BACKUPS: NavItem = { icon: Archive, label: "Backups", href: "/dashboard/backups", permission: P.STORAGE.READ };

const EXPLORER: NavItem = { icon: SearchCode, label: "Database Explorer", href: "/dashboard/explorer", permission: P.SOURCES.VIEW };
const HISTORY: NavItem = { icon: History, label: "History", href: "/dashboard/history", permission: P.HISTORY.READ };

const VAULT: NavItem = { icon: Lock, label: "Vault", href: "/dashboard/vault", permission: P.VAULT.READ };
const TEMPLATES: NavItem = { icon: LayoutTemplate, label: "Templates", href: "/dashboard/templates", permission: P.TEMPLATES.READ };
const USERS: NavItem = { icon: Users, label: "Users & Groups", href: "/dashboard/users", permission: [P.USERS.READ, P.GROUPS.READ, P.AUDIT.READ, P.API_KEYS.READ] };
/** With one tenant Settings is the Settings of the instance, as before tenants, with Recently deleted among its parts. */
const SETTINGS: NavItem = { icon: Settings, label: "Settings", href: "/dashboard/settings", permission: P.SETTINGS.READ };
/** With several, Settings under Administration is the one of the open tenant: its name, logo, notifications and Recently deleted. */
const TENANT_SETTINGS: NavItem = { icon: Settings, label: "Settings", href: "/dashboard/settings", permission: P.TENANT_SETTINGS.READ };

export const PLATFORM_TENANTS: NavItem = { icon: Building2, label: "Tenants", href: "/dashboard/platform/tenants", permission: P.PLATFORM.TENANTS_READ };
// The accounts and platform groups, and the sign-in providers on a tab of their own.
export const PLATFORM_USERS: NavItem = { icon: UserCog, label: "Users & Groups", href: "/dashboard/platform/users", permission: [P.PLATFORM.ACCOUNTS_READ, P.PLATFORM.SIGN_IN_READ] };
// The settings of the instance, from a platform group or the group in the home tenant.
export const PLATFORM_SETTINGS: NavItem = { icon: SlidersHorizontal, label: "Settings", href: "/dashboard/platform/settings", permission: P.SETTINGS.READ };

export const PLATFORM_LABEL = "Platform";

/** Every section that can show, before the rules leave some out. */
function allSections(several: boolean): NavGroup[] {
    return [
        { label: "General", items: [OVERVIEW, QUICK_SETUP] },
        { label: "Backup", items: [CONNECTIONS, JOBS, BACKUPS] },
        { label: "Explorer", items: [EXPLORER, HISTORY] },
        { label: "Administration", items: [VAULT, TEMPLATES, USERS, several ? TENANT_SETTINGS : SETTINGS] },
        ...(several ? [{ label: PLATFORM_LABEL, items: [PLATFORM_TENANTS, PLATFORM_USERS, PLATFORM_SETTINGS], platform: true }] : []),
    ];
}

/** Every page the sidebar can lead to, for the icons of the search. */
export const ALL_NAV_ITEMS: NavItem[] = [...new Map([...allSections(false), ...allSections(true)].flatMap((group) => group.items).map((item) => [`${item.href}|${item.label}`, item])).values()];

/** Whether the instance has more than one tenant, which brings the section Platform and the tenant settings. */
export const hasSeveralTenants = (tenantCount: number) => tenantCount > 1;

/**
 * The sections the viewer sees, each with the entries they may open by `can`. Platform shows with
 * more than one tenant, in every view, once any of its entries does: everything of it to a platform
 * admin, to someone of a platform group the entries its rights on the platform open, and Settings to
 * whoever holds the settings of the instance through the group in the home tenant. A customer never
 * gets it, since those rights never come from a group of a tenant.
 */
export function navSections(state: NavState, can: (permission: string) => boolean): NavGroup[] {
    const several = hasSeveralTenants(state.tenantCount);
    const mayOpen = (item: NavItem) => {
        if (item.quickSetupOnly && !state.showQuickSetup) return false;
        if (!item.permission || state.isPlatformAdmin) return true;
        const needs = Array.isArray(item.permission) ? item.permission : [item.permission];
        return needs.some(can);
    };
    return allSections(several)
        .map((group) => ({ ...group, items: group.items.filter(mayOpen) }))
        .filter((group) => group.items.length > 0);
}

/** "all 4 tenants", the line beside the label Platform, or "through Support" for someone of a platform group. */
export function platformLine(tenantCount: number, platformGroup?: string | null): string {
    if (platformGroup) return `through ${platformGroup}`;
    return `all ${tenantCount.toLocaleString("en-US")} tenants`;
}

/** Overview is the index route and only matches exactly. Every other entry also owns its sub-pages. */
export function isActiveRoute(pathname: string, href: string): boolean {
    if (href === "/dashboard") return pathname === href;
    return pathname === href || pathname.startsWith(`${href}/`);
}
