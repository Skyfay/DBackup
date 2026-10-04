import { formatDistanceToNowStrict } from "date-fns";
import { Archive, KeyRound, Play, SunMoon, User, Users, type LucideIcon } from "lucide-react";
import { describeSchedule } from "@/components/dashboard/jobs/job-schedule";
import { kindNames } from "@/components/adapter/connection-columns";
import { databaseHref } from "@/components/dashboard/explorer/database-model";
import { runHref } from "@/components/dashboard/history/run-links";
import { PROFILE_PARTS } from "@/components/dashboard/profile/profile-parts";
import { SETTINGS_PARTS } from "@/components/dashboard/settings/settings-parts";
import { KIND_ICONS } from "@/components/dashboard/templates/template-cells";
import { CREDENTIAL_TYPE_INFO } from "@/components/settings/credential-types";
import { PERMISSIONS } from "@/lib/auth/permissions";
import type { CredentialType } from "@/lib/core/credentials";
import { STORAGE_ROLES } from "@/lib/core/storage-roles";
import { formatBytes } from "@/lib/utils";
import type { SearchHit, TemplateKind } from "@/services/search/search-types";
import { navGroups } from "./app-sidebar";

/** The groups of the search, in the order they show. */
export type SearchGroup = "recent" | "jobs" | "connections" | "databases" | "backups" | "runs" | "access" | "templates" | "vault" | "settings" | "pages" | "actions";

export const GROUP_ORDER: SearchGroup[] = ["recent", "jobs", "connections", "databases", "backups", "runs", "access", "templates", "vault", "settings", "pages", "actions"];

export const GROUP_LABELS: Record<SearchGroup, string> = {
    recent: "Recent",
    jobs: "Jobs",
    connections: "Connections",
    databases: "Databases",
    backups: "Backups",
    runs: "Runs",
    access: "Users & Groups",
    templates: "Templates",
    vault: "Vault",
    settings: "Settings",
    pages: "Go to",
    actions: "Actions",
};

/** The kinds the chips above the results narrow the search to, each shown to whoever may open one of its lists. */
export const SEARCH_CHIPS = [
    { value: "all", label: "All", needsAny: [] },
    { value: "jobs", label: "Jobs", needsAny: [PERMISSIONS.JOBS.READ] },
    { value: "connections", label: "Connections", needsAny: [PERMISSIONS.SOURCES.VIEW, PERMISSIONS.DESTINATIONS.READ, PERMISSIONS.NOTIFICATIONS.READ] },
    { value: "databases", label: "Databases", needsAny: [PERMISSIONS.SOURCES.VIEW] },
    { value: "backups", label: "Backups", needsAny: [PERMISSIONS.STORAGE.READ] },
    { value: "runs", label: "Runs", needsAny: [PERMISSIONS.HISTORY.READ] },
    { value: "access", label: "Users", needsAny: [PERMISSIONS.USERS.READ, PERMISSIONS.GROUPS.READ, PERMISSIONS.API_KEYS.READ] },
    { value: "templates", label: "Templates", needsAny: [PERMISSIONS.TEMPLATES.READ] },
    { value: "vault", label: "Vault", needsAny: [PERMISSIONS.VAULT.READ] },
    // Holds the own profile too, which everyone may open.
    { value: "settings", label: "Settings", needsAny: [] },
] as const satisfies readonly { value: "all" | SearchGroup; label: string; needsAny: readonly string[] }[];

export type SearchChip = (typeof SEARCH_CHIPS)[number]["value"];

/** The chips of the kinds the viewer may see, so the search never hints at the others. */
export function visibleChips(can: (permission: string) => boolean) {
    return SEARCH_CHIPS.filter((chip) => chip.needsAny.length === 0 || chip.needsAny.some(can));
}

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
    /** The icon by name, like `user` or `page:/dashboard/jobs`, so a recent entry keeps it in storage. */
    icon?: string;
    /** Every permission the page it opens needs, checked again for a recent entry. */
    needs?: readonly string[];
}

/** Whether the viewer may open what a row leads to, for a recent entry kept from before. */
export function mayOpen(item: SearchItem, can: (permission: string) => boolean): boolean {
    return (item.needs ?? []).every(can);
}

/** The second line of a row: what it is, how it is now and when it happened. */
export function subLine(item: SearchItem): string {
    return [item.sub, item.state, item.at ? formatDistanceToNowStrict(new Date(item.at), { addSuffix: true }) : null].filter(Boolean).join(" · ");
}

const NAMED_ICONS: Record<string, LucideIcon> = { backups: Archive, user: User, group: Users, apiKey: KeyRound, key: KeyRound, theme: SunMoon, run: Play };
const PAGE_ICONS = new Map<string, LucideIcon>(navGroups.flatMap((group) => group.items.map((item) => [item.href, item.icon] as const)));
const TEMPLATE_ICONS: Record<TemplateKind, LucideIcon> = { retention: KIND_ICONS.retention, naming: KIND_ICONS.naming, schedules: KIND_ICONS.schedule, notifications: KIND_ICONS.notification, excludes: KIND_ICONS.exclude };

/** The icon a row shows when it has no logo of an adapter, the one of the tab or page it opens. */
export function iconOf(item: SearchItem): LucideIcon | undefined {
    if (!item.icon) return undefined;
    const at = item.icon.indexOf(":");
    const space = at < 0 ? item.icon : item.icon.slice(0, at);
    const id = item.icon.slice(at + 1);
    switch (space) {
        case "page": return PAGE_ICONS.get(id);
        case "settings": return SETTINGS_PARTS.find((part) => part.id === id)?.icon;
        case "profile": return PROFILE_PARTS.find((part) => part.id === id)?.icon;
        case "template": return TEMPLATE_ICONS[id as TemplateKind];
        case "credential": return CREDENTIAL_TYPE_INFO[id as CredentialType]?.icon;
        default: return NAMED_ICONS[space];
    }
}

const CONNECTION_TABS: Record<string, string> = { database: "databases", source: "directory-sources", destination: "destinations", notification: "notifications" };
const CONNECTION_NEEDS: Record<string, string> = { database: PERMISSIONS.SOURCES.VIEW, storage: PERMISSIONS.DESTINATIONS.READ, notification: PERMISSIONS.NOTIFICATIONS.READ };

function connectionRole(hit: Extract<SearchHit, { kind: "connection" }>): string {
    if (hit.type === "database") return "database";
    if (hit.type === "notification") return "notification";
    return hit.storageRole === STORAGE_ROLES.SOURCE ? "source" : "destination";
}

const ROLE_WORDS: Record<string, string> = { database: "Database connection", source: "Directory source", destination: "Destination", notification: "Channel" };
const STATUS_WORDS: Record<string, string> = { OFFLINE: "does not answer", DEGRADED: "failed its last check", ONLINE: "answers", AWAY: "air-gapped, not connected" };
const RUN_WORDS: Record<string, string> = { Success: "Succeeded", Failed: "Failed", Partial: "Missed a copy", Running: "Running", Pending: "Waiting", Cancelled: "Cancelled" };
const TEMPLATE_WORDS: Record<TemplateKind, string> = { retention: "Retention policy", naming: "File name", schedules: "Schedule preset", notifications: "Notification template", excludes: "Exclude patterns" };

const count = (value: number, one: string, many: string) => `${value} ${value === 1 ? one : many}`;
const link = (path: string, params: Record<string, string>) => `${path}?${new URLSearchParams(params).toString()}`;

/** A hit of the server as a row of the search, with what opening it needs. */
export function hitItems(hit: SearchHit): SearchItem[] {
    switch (hit.kind) {
        case "job": {
            const state = !hit.enabled ? "paused" : hit.lastStatus === "Failed" ? "failed on its last run" : hit.lastStatus === "Partial" ? "missed a copy on its last run" : null;
            return [{ key: `job:${hit.id}`, group: "jobs", title: hit.name, sub: describeSchedule(hit.schedule).text, state, kind: "Job", href: link("/dashboard/jobs", { job: hit.id }), adapterId: hit.adapterId, needs: [PERMISSIONS.JOBS.READ] }];
        }
        case "backups":
            return [{ key: `backups:${hit.jobId}`, group: "backups", title: `Backups of ${hit.name}`, sub: "Every backup of the job at every destination", kind: "Backups", href: link("/dashboard/backups", { job: hit.jobId }), icon: "backups", needs: [PERMISSIONS.STORAGE.READ] }];
        case "connection": {
            const role = connectionRole(hit);
            return [{
                key: `connection:${hit.id}`,
                group: "connections",
                title: hit.name,
                sub: `${ROLE_WORDS[role]} · ${kindNames.get(hit.adapterId) ?? hit.adapterId}`,
                state: hit.type === "notification" ? null : STATUS_WORDS[hit.status],
                kind: "Connection",
                href: link("/dashboard/connections", { tab: CONNECTION_TABS[role], open: hit.id }),
                adapterId: hit.adapterId,
                needs: [CONNECTION_NEEDS[hit.type] ?? PERMISSIONS.DESTINATIONS.READ],
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
                needs: [PERMISSIONS.SOURCES.VIEW],
            }];
        case "run":
            return [{ key: `run:${hit.id}`, group: "runs", title: `Run of ${hit.name}`, sub: "", state: RUN_WORDS[hit.status] ?? hit.status, at: hit.startedAt, kind: "Run", href: runHref(hit.id), adapterId: hit.adapterId, needs: [PERMISSIONS.HISTORY.READ] }];
        case "user":
            return [{ key: `user:${hit.id}`, group: "access", title: hit.name, sub: `${hit.email} · ${hit.group ?? "No group"}`, kind: "User", href: link("/dashboard/users", { tab: "users", open: hit.id }), icon: "user", needs: [PERMISSIONS.USERS.READ] }];
        case "group":
            return [{ key: `group:${hit.id}`, group: "access", title: hit.name, sub: count(hit.people, "person", "people"), kind: "Group", href: link("/dashboard/users", { tab: "groups", open: hit.id }), icon: "group", needs: [PERMISSIONS.GROUPS.READ] }];
        case "apiKey":
            return [{
                key: `apikey:${hit.id}`,
                group: "access",
                title: hit.name,
                sub: `${hit.prefix}… · ${hit.owner}`,
                state: !hit.enabled ? "off" : hit.expired ? "expired" : null,
                kind: "API key",
                href: link("/dashboard/users", { tab: "apikeys", open: hit.id }),
                icon: "apiKey",
                needs: [PERMISSIONS.API_KEYS.READ],
            }];
        case "template": {
            const detail = hit.template === "schedules" && hit.detail ? describeSchedule(hit.detail).text : hit.detail;
            return [{
                key: `template:${hit.id}`,
                group: "templates",
                title: hit.name,
                sub: [TEMPLATE_WORDS[hit.template], detail].filter(Boolean).join(" · "),
                kind: "Template",
                href: link("/dashboard/templates", { tab: hit.template, open: hit.id }),
                icon: `template:${hit.template}`,
                needs: [PERMISSIONS.TEMPLATES.READ],
            }];
        }
        case "key":
            return [{
                key: `key:${hit.id}`,
                group: "vault",
                title: hit.name,
                sub: hit.jobs === 0 ? "Encryption key no job uses" : `Encryption key of ${count(hit.jobs, "job", "jobs")}`,
                kind: "Key",
                href: link("/dashboard/vault", { tab: "encryption", open: hit.id }),
                icon: "key",
                needs: [PERMISSIONS.VAULT.READ],
            }];
        case "credential":
            return [{
                key: `credential:${hit.id}`,
                group: "vault",
                title: hit.name,
                sub: CREDENTIAL_TYPE_INFO[hit.type as CredentialType]?.title ?? hit.type,
                kind: "Credential",
                href: link("/dashboard/vault", { tab: "credentials", open: hit.id }),
                icon: `credential:${hit.type}`,
                needs: [PERMISSIONS.VAULT.READ, PERMISSIONS.CREDENTIALS.READ],
            }];
    }
}
