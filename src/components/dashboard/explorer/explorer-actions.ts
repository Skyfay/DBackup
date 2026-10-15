import type * as React from "react";
import { ArrowRight, ArrowUpRight, Building2, CalendarClock, Database, Server } from "lucide-react";
import type { BackupAction, BackupActionGroup } from "@/components/dashboard/storage/explorer/backup-actions";
import type { ExplorerDatabase } from "@/services/databases/database-explorer-types";
import { backupsHref } from "./database-data";

/**
 * The entries of the menus of a database and a server, as data, so the button at the end of a row
 * and a right click offer the same. Every entry only opens a page, nothing here changes a record.
 */

interface OpenInput {
    /** Whether the viewer may see jobs, which the backups and jobs of a record need. */
    coverage: boolean;
    canOpenBackups: boolean;
    /** The tenant of the record while the list holds every tenant, null anywhere else. */
    tenantName: string | null;
    /** Opens the page of the record, in All tenants in its tenant. */
    onOpen: () => void;
    /** Opens another page of the dashboard. */
    go: (href: string) => void;
}

/** Open, which in All tenants names the tenant the page opens in. */
function openAction(icon: React.ComponentType<{ className?: string }>, tenantName: string | null, onOpen: () => void): BackupAction {
    return tenantName
        ? { id: "open-in-tenant", label: `Open in ${tenantName}`, icon: Building2, onSelect: onOpen, tone: "neutral" }
        : { id: "open", label: "Open", icon, onSelect: onOpen, tone: "neutral" };
}

function backupsAction(jobIds: string[], { coverage, canOpenBackups, go }: OpenInput): BackupAction[] {
    return coverage && canOpenBackups && jobIds.length > 0
        ? [{ id: "backups", label: "Open backups", icon: ArrowRight, onSelect: () => go(backupsHref(jobIds)), tone: "neutral" }]
        : [];
}

/** What a database offers: its page, its backups and the job that backs it up. */
export function databaseActions(database: Pick<ExplorerDatabase, "jobIds">, input: OpenInput): BackupActionGroup[] {
    const { jobIds } = database;
    return [{
        actions: [
            openAction(Database, input.tenantName, input.onOpen),
            ...backupsAction(jobIds, input),
            ...(input.coverage
                ? [{
                    id: "jobs",
                    label: jobIds.length === 0 ? "Open jobs" : "Open job",
                    icon: CalendarClock,
                    onSelect: () => input.go(jobIds.length > 0 ? `/dashboard/jobs?job=${encodeURIComponent(jobIds[0])}` : "/dashboard/jobs"),
                    tone: "neutral" as const,
                }]
                : []),
        ],
    }];
}

/** What a server offers: its page, the backups of its jobs and the connections. */
export function serverActions(jobIds: string[], input: OpenInput): BackupActionGroup[] {
    return [{
        actions: [
            openAction(Server, input.tenantName, input.onOpen),
            ...backupsAction(jobIds, input),
            { id: "connection", label: "Open connection", icon: ArrowUpRight, onSelect: () => input.go("/dashboard/connections"), tone: "neutral" },
        ],
    }];
}
