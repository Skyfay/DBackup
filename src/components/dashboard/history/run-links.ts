/**
 * Every link to a run opens its page, and names the page it came from, so the back arrow of the
 * run can say where it leads and go there like the Back of the browser.
 */

export type RunOrigin = "history" | "overview" | "jobs" | "backups" | "explorer" | "connections" | "settings" | "restore" | "setup" | "apikeys";

const ORIGINS: Record<RunOrigin, { label: string; href: string }> = {
    history: { label: "History", href: "/dashboard/history" },
    overview: { label: "Overview", href: "/dashboard" },
    jobs: { label: "Jobs", href: "/dashboard/jobs" },
    backups: { label: "Backups", href: "/dashboard/backups" },
    explorer: { label: "Database Explorer", href: "/dashboard/explorer" },
    connections: { label: "Connections", href: "/dashboard/connections" },
    settings: { label: "Settings", href: "/dashboard/settings" },
    restore: { label: "Backups", href: "/dashboard/backups" },
    setup: { label: "Quick Setup", href: "/dashboard/setup" },
    apikeys: { label: "API keys", href: "/dashboard/users?tab=apikeys" },
};

export function runHref(id: string, from: RunOrigin = "history"): string {
    return `/dashboard/history/run?id=${encodeURIComponent(id)}&from=${from}`;
}

/** Where the back arrow of a run leads. A run opened from outside the app leads to the History list. */
export function originOf(from: string | null): { key: RunOrigin; label: string; href: string } {
    const key = from && from in ORIGINS ? from as RunOrigin : "history";
    return { key, ...ORIGINS[key] };
}
