import { profileIndex } from "@/components/dashboard/profile/profile-index";
import { PROFILE_PARTS, type ProfilePartId } from "@/components/dashboard/profile/profile-parts";
import { searchSettings, settingsIndex, wordsOf } from "@/components/dashboard/settings/settings-index";
import { SETTINGS_PARTS } from "@/components/dashboard/settings/settings-parts";
import { PERMISSIONS } from "@/lib/auth/permissions";
import type { SearchHit } from "@/services/search/search-types";
import { navGroups } from "./app-sidebar";
import type { SearchItem } from "./search-items";

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

/** The pages of the sidebar the viewer may open, all while the search is empty. */
export function pageItems(query: string, can: (permission: string) => boolean): SearchItem[] {
    const pages = navGroups.flatMap((group) => group.items)
        .filter((item) => !item.quickSetupOnly)
        .filter((item) => !item.permission || (Array.isArray(item.permission) ? item.permission : [item.permission]).some(can));
    const all: SearchItem[] = [
        ...pages.map((item): SearchItem => ({ key: `page:${item.href}`, group: "pages", title: item.label, sub: "Page", kind: "Page", href: item.href, icon: `page:${item.href}` })),
        { key: "page:/dashboard/profile", group: "pages", title: "Profile", sub: "Your account, sign-in and the look of DBackup", kind: "Page", href: "/dashboard/profile", icon: "profile:account" },
    ];
    return query.trim() ? all.filter((item) => matches(item.title, query)) : all;
}

/** The parts and settings of Settings and of the profile whose words the search starts. */
export function settingItems(query: string, canSettings: boolean): SearchItem[] {
    if (!query.trim()) return [];
    const partLabel = new Map<string, string>(SETTINGS_PARTS.map((part) => [part.id, part.label] as const));
    const settings = canSettings
        ? searchSettings(settingsIndex([]), query).hits.map((hit): SearchItem => ({
            key: `setting:${hit.id}`,
            group: "settings",
            title: hit.label,
            sub: hit.id === hit.part ? "Settings" : `Settings › ${partLabel.get(hit.part) ?? hit.part}`,
            kind: "Setting",
            href: `/dashboard/settings?part=${hit.part}`,
            icon: `settings:${hit.part}`,
            needs: [PERMISSIONS.SETTINGS.READ],
        }))
        : [];
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
    return [...settings, ...profile].slice(0, 6);
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
