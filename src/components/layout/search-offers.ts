import { profileIndex } from "@/components/dashboard/profile/profile-index";
import { PROFILE_PARTS, type ProfilePartId } from "@/components/dashboard/profile/profile-parts";
import { searchSettings, settingsIndex, wordsOf } from "@/components/dashboard/settings/settings-index";
import { SETTINGS_PARTS, isTenantPart } from "@/components/dashboard/settings/settings-parts";
import { TENANT_SETTINGS_PART_IDS, tenantPartOf, tenantSettingsIndex, type TenantSettingsPartId } from "@/components/dashboard/tenant-settings/tenant-settings-parts";
import { PERMISSIONS } from "@/lib/auth/permissions";
import type { SearchHit } from "@/services/search/search-types";
import { hasSeveralTenants, navSections } from "./nav-sections";
import type { SearchItem } from "./search-items";

/** What the pages the search offers depend on beside the permissions: the instance and the viewer. */
export interface SearchView {
    /** How many tenants the instance has. With more than one the settings split into the tenant's and the platform's. */
    tenantCount?: number;
    isPlatformAdmin?: boolean;
    allTenants?: boolean;
    /** May read the settings of the open tenant. */
    canTenantSettings?: boolean;
}

/**
 * What the search offers without asking the server: the pages of the sidebar, the parts and
 * settings of Settings and of the profile, and the actions. Each only for whoever may open it.
 */

/** Whether every word of the search starts a word of the text, like the search of the Settings page. */
function matches(text: string, query: string): boolean {
    const terms = wordsOf(query);
    const words = wordsOf(text);
    return terms.length > 0 && terms.every((term) => words.some((word) => word.startsWith(term)));
}

/** The pages of the sidebar the viewer may open, all while the search is empty. The pages of Platform say so. */
export function pageItems(query: string, can: (permission: string) => boolean, view: SearchView = {}): SearchItem[] {
    const sections = navSections({ tenantCount: view.tenantCount ?? 1, isPlatformAdmin: view.isPlatformAdmin ?? false, allTenants: view.allTenants }, can);
    const pages = sections.flatMap((group) => group.items.map((item) => ({ item, platform: group.platform === true })));
    const all: SearchItem[] = [
        ...pages.map(({ item, platform }): SearchItem => ({
            key: `page:${item.href}`,
            group: "pages",
            title: item.label,
            sub: platform ? "Platform page" : "Page",
            kind: "Page",
            href: item.href,
            icon: `page:${item.href}`,
        })),
        { key: "page:/dashboard/profile", group: "pages", title: "Profile", sub: "Your account, sign-in and the look of DBackup", kind: "Page", href: "/dashboard/profile", icon: "profile:account" },
    ];
    return query.trim() ? all.filter((item) => matches(item.title, query)) : all;
}

/**
 * The settings of the open tenant whose words the search starts. Only with more than one tenant
 * and never in All tenants, which has no tenant open.
 */
function tenantSettingItems(query: string): SearchItem[] {
    return searchSettings<TenantSettingsPartId>(tenantSettingsIndex(), query, TENANT_SETTINGS_PART_IDS).hits.map((hit): SearchItem => ({
        key: `tenant-setting:${hit.id}`,
        group: "settings",
        title: hit.label,
        sub: hit.id === hit.part ? "Tenant settings" : `Tenant settings › ${tenantPartOf(hit.part).label}`,
        kind: "Setting",
        href: `/dashboard/settings?part=${hit.part}`,
        icon: "page:/dashboard/settings",
        needs: [PERMISSIONS.TENANT_SETTINGS.READ],
    }));
}

/**
 * The parts and settings of Settings and of the profile whose words the search starts. With more
 * than one tenant the settings of the instance are the platform's, beside the ones of the tenant,
 * which hold Recently deleted. With one it is a part of Settings for whoever may read the tenant
 * settings too.
 */
export function settingItems(query: string, canSettings: boolean, view: SearchView = {}): SearchItem[] {
    if (!query.trim()) return [];
    const several = hasSeveralTenants(view.tenantCount ?? 1);
    const where = several ? "Platform settings" : "Settings";
    const partLabel = new Map<string, string>(SETTINGS_PARTS.map((part) => [part.id, part.label] as const));
    const settings = canSettings
        ? searchSettings(settingsIndex([], [], !several && view.canTenantSettings === true), query).hits.map((hit): SearchItem => ({
            key: `setting:${hit.id}`,
            group: "settings",
            title: hit.label,
            sub: hit.id === hit.part ? where : `${where} › ${partLabel.get(hit.part) ?? hit.part}`,
            kind: "Setting",
            href: `${several ? "/dashboard/platform/settings" : "/dashboard/settings"}?part=${hit.part}`,
            icon: `settings:${hit.part}`,
            needs: isTenantPart(hit.part) ? [PERMISSIONS.SETTINGS.READ, PERMISSIONS.TENANT_SETTINGS.READ] : [PERMISSIONS.SETTINGS.READ],
        }))
        : [];
    const tenant = several && !view.allTenants && view.canTenantSettings ? tenantSettingItems(query) : [];
    const profileLabel = new Map(PROFILE_PARTS.map((part) => [part.id, part.label] as const));
    const profile = searchSettings<ProfilePartId>(profileIndex(), query, PROFILE_PARTS.map((part) => part.id)).hits.map((hit): SearchItem => ({
        key: `profile:${hit.id}`,
        group: "settings",
        title: hit.label,
        sub: hit.id === hit.part ? "Profile" : `Profile › ${profileLabel.get(hit.part) ?? hit.part}`,
        kind: "Profile",
        href: `/dashboard/profile?part=${hit.part}`,
        icon: `profile:${hit.part}`,
    }));
    return [...tenant, ...settings, ...profile].slice(0, 6);
}

/** What the search can do instead of open: switch the theme, and start a job it found for someone who may. */
export function actionItems(query: string, hits: SearchHit[], can: (permission: string) => boolean): SearchItem[] {
    const theme: SearchItem = { key: "action:theme", group: "actions", title: "Switch the theme", sub: "Light or dark, for this browser", kind: "Action", action: "theme", icon: "theme" };
    const run = can(PERMISSIONS.JOBS.EXECUTE)
        ? hits.flatMap((hit): SearchItem[] => (hit.kind === "job" && hit.enabled ? [{
            key: `action:run:${hit.id}`,
            group: "actions",
            title: `Run ${hit.name} now`,
            sub: "Starts the job, like Run now in its menu",
            kind: "Action",
            action: "run",
            jobId: hit.id,
            icon: "run",
        }] : [])).slice(0, 2)
        : [];
    const themeHit = !query.trim() || matches("switch the theme light dark", query) ? [theme] : [];
    return [...run, ...themeHit];
}
