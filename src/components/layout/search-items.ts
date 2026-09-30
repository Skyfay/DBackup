import { formatDistanceToNowStrict } from "date-fns";
import { describeSchedule } from "@/components/dashboard/jobs/job-schedule";
import { kindNames } from "@/components/adapter/connection-columns";
import { databaseHref } from "@/components/dashboard/explorer/database-model";
import { runHref } from "@/components/dashboard/history/run-links";
import { profileIndex } from "@/components/dashboard/profile/profile-index";
import { PROFILE_PARTS, type ProfilePartId } from "@/components/dashboard/profile/profile-parts";
import { searchSettings, settingsIndex, wordsOf } from "@/components/dashboard/settings/settings-index";
import { SETTINGS_PARTS } from "@/components/dashboard/settings/settings-parts";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { STORAGE_ROLES } from "@/lib/core/storage-roles";
import { formatBytes } from "@/lib/utils";
import type { SearchHit } from "@/services/search/search-types";
import { navGroups } from "./app-sidebar";

/** The groups of the search, in the order they show. */
export type SearchGroup = "recent" | "jobs" | "connections" | "databases" | "backups" | "runs" | "settings" | "pages" | "actions";

/** The kinds the chips above the results narrow the search to. */
export const SEARCH_CHIPS = [
    { value: "all", label: "All" },
    { value: "jobs", label: "Jobs" },
    { value: "connections", label: "Connections" },
    { value: "databases", label: "Databases" },
    { value: "backups", label: "Backups" },
    { value: "runs", label: "Runs" },
    { value: "settings", label: "Settings" },
] as const;

export type SearchChip = (typeof SEARCH_CHIPS)[number]["value"];

export const GROUP_LABELS: Record<SearchGroup, string> = {
    recent: "Recent",
    jobs: "Jobs",
    connections: "Connections",
    databases: "Databases",
    backups: "Backups",
    runs: "Runs",
    settings: "Settings",
    pages: "Go to",
    actions: "Actions",
};

export interface SearchItem {
    /** Unique in the list, also what cmdk selects. */
    key: string;
    group: SearchGroup;
    title: string;
    /** What it is, which stays true, like the schedule of a job. */
    sub: string;
    /** How it is now, like a job whose last run failed. A recent entry leaves it out, it would go stale. */
    state?: string | null;
    /** When it happened, shown as a time ago, so it stays right in a recent entry. */
    at?: string;
    /** What it is, on the right of the row. */
    kind: string;
    href?: string;
    /** Done in the page instead of opening one. */
    action?: "theme" | "run";
    jobId?: string;
    adapterId?: string | null;
    /** The href of a page, whose icon it shows. */
    page?: string;
}

const CONNECTION_TABS: Record<string, string> = { database: "databases", source: "directory-sources", destination: "destinations", notification: "notifications" };

function connectionRole(hit: Extract<SearchHit, { kind: "connection" }>): string {
    if (hit.type === "database") return "database";
    if (hit.type === "notification") return "notification";
    return hit.storageRole === STORAGE_ROLES.SOURCE ? "source" : "destination";
}

const ROLE_WORDS: Record<string, string> = { database: "Database connection", source: "Directory source", destination: "Destination", notification: "Channel" };
const STATUS_WORDS: Record<string, string> = { OFFLINE: "does not answer", DEGRADED: "failed its last check", ONLINE: "answers" };
const RUN_WORDS: Record<string, string> = { Success: "Succeeded", Failed: "Failed", Partial: "Missed a copy", Running: "Running", Pending: "Waiting", Cancelled: "Cancelled" };

/** A hit of the server as a row of the search. */
export function hitItems(hit: SearchHit, can: (permission: string) => boolean): SearchItem[] {
    switch (hit.kind) {
        case "job": {
            const state = !hit.enabled ? "paused" : hit.lastStatus === "Failed" ? "failed on its last run" : hit.lastStatus === "Partial" ? "missed a copy on its last run" : null;
            const job: SearchItem = {
                key: `job:${hit.id}`,
                group: "jobs",
                title: hit.name,
                sub: describeSchedule(hit.schedule).text,
                state,
                kind: "Job",
                href: `/dashboard/jobs?job=${encodeURIComponent(hit.id)}`,
                adapterId: hit.adapterId,
            };
            // The backups of a job are one click away, so a job found by name finds them too.
            const backups: SearchItem[] = can(PERMISSIONS.STORAGE.READ)
                ? [{ key: `backups:${hit.id}`, group: "backups", title: `Backups of ${hit.name}`, sub: "Every backup of the job at every destination", kind: "Backups", href: `/dashboard/backups?job=${encodeURIComponent(hit.id)}` }]
                : [];
            return [job, ...backups];
        }
        case "connection": {
            const role = connectionRole(hit);
            return [{
                key: `connection:${hit.id}`,
                group: "connections",
                title: hit.name,
                sub: `${ROLE_WORDS[role]} · ${kindNames.get(hit.adapterId) ?? hit.adapterId}`,
                state: hit.type === "notification" ? null : STATUS_WORDS[hit.status],
                kind: "Connection",
                href: `/dashboard/connections?tab=${CONNECTION_TABS[role]}&open=${encodeURIComponent(hit.id)}`,
                adapterId: hit.adapterId,
            }];
        }
        case "database":
            return [{
                key: `database:${hit.serverId}:${hit.name}`,
                group: "databases",
                title: hit.name,
                sub: [`on ${hit.serverName}`, hit.sizeInBytes !== null ? formatBytes(hit.sizeInBytes, 1) : null].filter(Boolean).join(" · "),
                kind: "Database",
                href: databaseHref({ serverId: hit.serverId, kind: "database", name: hit.name }),
                adapterId: hit.adapterId,
            }];
        case "run":
            return [{
                key: `run:${hit.id}`,
                group: "runs",
                title: `Run of ${hit.name}`,
                sub: "",
                state: RUN_WORDS[hit.status] ?? hit.status,
                at: hit.startedAt,
                kind: "Run",
                href: runHref(hit.id),
                adapterId: hit.adapterId,
            }];
    }
}

/** The second line of a row: what it is, how it is now and when it happened. */
export function subLine(item: SearchItem): string {
    return [item.sub, item.state, item.at ? formatDistanceToNowStrict(new Date(item.at), { addSuffix: true }) : null].filter(Boolean).join(" · ");
}

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
        ...pages.map((item) => ({ key: `page:${item.href}`, group: "pages" as const, title: item.label, sub: "Page", kind: "Page", href: item.href, page: item.href })),
        { key: "page:/dashboard/profile", group: "pages", title: "Profile", sub: "Your account, sign-in and the look of DBackup", kind: "Page", href: "/dashboard/profile", page: "/dashboard/profile" },
    ];
    return query.trim() ? all.filter((item) => matches(item.title, query)) : all;
}

/** The parts and settings of Settings and of the profile whose words the search starts. */
export function settingItems(query: string, canSettings: boolean): SearchItem[] {
    if (!query.trim()) return [];
    const partLabel = new Map<string, string>([...SETTINGS_PARTS.map((part) => [part.id, part.label] as const)]);
    const settings = canSettings
        ? searchSettings(settingsIndex([]), query).hits.map((hit): SearchItem => ({
            key: `setting:${hit.id}`,
            group: "settings",
            title: hit.label,
            sub: hit.id === hit.part ? "Settings" : `Settings › ${partLabel.get(hit.part) ?? hit.part}`,
            kind: "Setting",
            href: `/dashboard/settings?part=${hit.part}`,
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
    }));
    return [...settings, ...profile].slice(0, 6);
}

/** What the search can do instead of open: switch the theme, and start a job it found. */
export function actionItems(query: string, jobs: SearchHit[], can: (permission: string) => boolean): SearchItem[] {
    const theme: SearchItem = { key: "action:theme", group: "actions", title: "Switch the theme", sub: "Light or dark, for this browser", kind: "Action", action: "theme" };
    const run = can(PERMISSIONS.JOBS.EXECUTE)
        ? jobs.flatMap((hit) => (hit.kind === "job" && hit.enabled ? [{
            key: `action:run:${hit.id}`,
            group: "actions" as const,
            title: `Run ${hit.name} now`,
            sub: "Starts the job, like Run now in its menu",
            kind: "Action",
            action: "run" as const,
            jobId: hit.id,
        }] : [])).slice(0, 2)
        : [];
    const themeHit = !query.trim() || matches("switch the theme light dark", query) ? [theme] : [];
    return [...run, ...themeHit];
}
