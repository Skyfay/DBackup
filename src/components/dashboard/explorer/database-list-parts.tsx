"use client";

import Link from "next/link";
import { Database } from "lucide-react";
import { AdapterIcon } from "@/components/adapter/adapter-icon";
import { kindNames } from "@/components/adapter/connection-columns";
import { count } from "@/components/dashboard/storage/explorer/explorer-format";
import { DestinationTile } from "@/components/dashboard/storage/explorer/explorer-cells";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import type { DataTableFilterableColumn } from "@/components/ui/data-table";
import { JOIN_END } from "@/components/ui/page-head";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, formatBytes } from "@/lib/utils";
import type { DatabaseOverview, ExplorerDatabase, ExplorerDbJob, ExplorerServer } from "@/services/databases/database-explorer-types";
import { JobsCell, engineOf, holdsOf, subOf } from "./database-columns";
import type { DatabaseState } from "./database-model";

const STATES: { value: DatabaseState; label: string; dot?: string; needsJobs: boolean }[] = [
    { value: "no-job", label: "In no job", dot: "bg-warning", needsJobs: true },
    { value: "backed-up", label: "In a job", needsJobs: true },
    { value: "never", label: "In a job, no backup yet", needsJobs: true },
    { value: "unread", label: "Its server was not read", dot: "bg-warning", needsJobs: false },
];

/**
 * The filters of the list: the server, the engine, the job and the state of each database. The
 * numbers beside the values come from the table, so each filter counts what the others leave and
 * sets the values without a database apart at its end.
 */
export function databaseFilters(overview: DatabaseOverview): DataTableFilterableColumn<ExplorerDatabase>[] {
    const { servers, jobs, coverage } = overview;
    const shared = { note: "The numbers count the databases", unavailableLabel: "No databases with the other filters" };
    const engines = [...new Set(servers.map((server) => server.adapterId))];
    const filters: DataTableFilterableColumn<ExplorerDatabase>[] = [
        {
            id: "server",
            title: "Server",
            ...shared,
            options: servers.map((server) => ({
                value: server.id,
                label: server.name,
                lead: <AdapterIcon adapterId={server.adapterId} className="size-4 shrink-0" />,
            })),
        },
        {
            id: "engine",
            title: "Engine",
            ...shared,
            options: engines.map((adapterId) => ({
                value: adapterId,
                label: kindNames.get(adapterId) ?? adapterId,
                lead: <AdapterIcon adapterId={adapterId} className="size-4 shrink-0" />,
            })),
        },
    ];
    if (coverage) {
        filters.push({
            id: "job",
            title: "Job",
            ...shared,
            options: [
                ...jobs.filter((job) => job.enabled).map((job) => ({ value: job.id, label: job.name })),
                { value: "none", label: "In no job" },
            ],
        });
    }
    filters.push({
        id: "state",
        title: "State",
        ...shared,
        options: STATES.filter((state) => coverage || !state.needsJobs).map((state) => ({
            value: state.value,
            label: state.label,
            lead: state.dot ? <span className="flex size-4 shrink-0 items-center justify-center"><span className={`size-2 rounded-full ${state.dot}`} /></span> : undefined,
        })),
    });
    return filters;
}

/** A database on a phone, which has no room for the table. The whole card opens its page. */
export function DatabaseCard({ database, server, jobsById, coverage, href, actions }: {
    database: ExplorerDatabase;
    server: ExplorerServer | undefined;
    jobsById: Map<string, ExplorerDbJob>;
    coverage: boolean;
    href: string;
    actions: React.ReactNode;
}) {
    const instance = database.kind === "instance";
    return (
        <div className="relative min-w-0 rounded-xl border bg-card p-4 shadow-sm has-[a:focus-visible]:bg-muted/50">
            <div className="flex items-center gap-3">
                <DestinationTile destination={{ adapterId: server?.adapterId ?? "" }} />
                <Link href={href} className="min-w-0 flex-1 outline-none after:absolute after:inset-0">
                    <span className="block truncate font-medium">{database.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{instance ? subOf(database, server) : `${server?.name} · ${engineOf(server)}`}</span>
                </Link>
                <div className="relative z-10">{actions}</div>
            </div>
            <div className="mt-3 flex items-center justify-between gap-3 text-sm">
                <span className="tabular-nums">{database.sizeInBytes === null ? "-" : formatBytes(database.sizeInBytes)}</span>
                <span className="text-xs text-muted-foreground">{instance ? holdsOf(database) : database.tableCount === null ? "" : count(database.tableCount, "table")}</span>
            </div>
            {coverage && (
                <div className="mt-3 flex items-center justify-between gap-3">
                    <JobsCell jobIds={database.jobIds} jobsById={jobsById} />
                    {database.lastBackup && <RelativeTime date={database.lastBackup.at} className="shrink-0 text-xs text-muted-foreground" />}
                </div>
            )}
        </div>
    );
}

/** The numbers and a list, while the page loads them. */
export function DatabasesSkeleton() {
    return (
        <div className="space-y-4 md:space-y-6" aria-busy="true">
            <span className="sr-only">Loading the databases</span>
            <div className="flex flex-wrap items-center gap-2 md:gap-3">
                <Skeleton className="h-9 w-40" />
                <Skeleton className="ml-auto h-9 w-40" />
            </div>
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border md:grid-cols-5">
                {Array.from({ length: 5 }, (_, index) => (
                    <div key={index} className="space-y-2 bg-card px-4 py-3">
                        <Skeleton className="h-3 w-16" />
                        <Skeleton className="h-5 w-20" />
                    </div>
                ))}
            </div>
            <div className="space-y-3 rounded-xl border bg-card p-4 shadow-sm">
                <div className="flex gap-2">
                    <Skeleton className="h-8 w-64" />
                    <Skeleton className="h-8 w-40" />
                </div>
                {Array.from({ length: 6 }, (_, index) => (
                    <div key={index} className="flex items-center gap-4 py-1.5">
                        <Skeleton className="size-8 rounded-lg" />
                        <Skeleton className="h-4 w-44" />
                        <Skeleton className="ml-auto h-4 w-24" />
                        <Skeleton className="h-5 w-32 rounded-md" />
                    </div>
                ))}
            </div>
        </div>
    );
}

/** What the page shows when it has nothing to list or could not load it. */
export function DatabasesEmpty({ title, children, joined = false }: { title: string; children: React.ReactNode; joined?: boolean }) {
    return (
        <div className={cn("rounded-xl border border-dashed bg-card px-4 py-16 text-center shadow-sm", joined && `md:border-solid ${JOIN_END}`)}>
            <Database className="mx-auto mb-4 size-10 text-muted-foreground/40" aria-hidden="true" />
            <p className="font-medium">{title}</p>
            <div className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{children}</div>
        </div>
    );
}
