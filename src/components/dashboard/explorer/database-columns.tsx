"use client";

import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { CalendarClock, TriangleAlert } from "lucide-react";
import { kindNames } from "@/components/adapter/connection-columns";
import { DestinationTile } from "@/components/dashboard/storage/explorer/explorer-cells";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { cn, formatBytes } from "@/lib/utils";
import type { ExplorerDatabase, ExplorerDbJob, ExplorerServer } from "@/services/databases/database-explorer-types";
import { compactCount, databaseHref, statesOf } from "./database-model";

/** A job that backs up a database, as a small chip with its name. */
export function JobChip({ name }: { name: string }) {
    return (
        <span className="inline-flex max-w-full min-w-0 items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium">
            <CalendarClock className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="truncate">{name}</span>
        </span>
    );
}

/** A database that no enabled job backs up. */
export function NoJobChip() {
    return (
        <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-dashed border-warning/70 px-1.5 py-0.5 text-xs font-medium text-warning">
            <TriangleAlert className="size-3" aria-hidden="true" />
            In no job
        </span>
    );
}

/** The jobs that back up a database, the first two by name and the rest counted. */
export function JobsCell({ jobIds, jobsById }: { jobIds: string[]; jobsById: Map<string, ExplorerDbJob> }) {
    if (jobIds.length === 0) return <NoJobChip />;
    const names = jobIds.map((id) => jobsById.get(id)?.name ?? "Unknown job");
    return (
        <span className="flex min-w-0 flex-wrap items-center gap-1">
            {names.slice(0, 2).map((name) => <JobChip key={name} name={name} />)}
            {names.length > 2 && <span className="text-xs text-muted-foreground" title={names.slice(2).join(", ")}>+{names.length - 2}</span>}
        </span>
    );
}

/** What an entry is beside its name: the engine, and for an instance how many of its databases hold keys. */
export function subOf(database: ExplorerDatabase, server: ExplorerServer | undefined): string {
    if (database.kind === "database") return engineOf(server);
    const total = database.logical.length + database.emptyLogical;
    return `${engineOf(server)} · ${database.logical.length} of ${total} databases hold keys`;
}

/** The tables of a database, or the keys of an instance. */
export function holdsOf(database: ExplorerDatabase): string {
    if (database.kind === "instance") return `${compactCount(database.keyCount ?? 0)} keys`;
    return database.tableCount === null ? "-" : database.tableCount.toLocaleString();
}

/** The version of a server in words, "PostgreSQL 16.4". */
export function engineOf(server: Pick<ExplorerServer, "adapterId" | "version"> | undefined): string {
    if (!server) return "";
    const kind = kindNames.get(server.adapterId) ?? server.adapterId;
    return server.version ? `${kind} ${server.version}` : kind;
}

interface ColumnsInput {
    serversById: Map<string, ExplorerServer>;
    jobsById: Map<string, ExplorerDbJob>;
    /** Whether the viewer may see jobs. Without it the list has no coverage. */
    coverage: boolean;
    /** The size of the biggest database, the full length of the bars. */
    biggest: number;
    renderActions: (database: ExplorerDatabase) => React.ReactNode;
}

/** The columns of the list of databases, with four only for the filters. */
export function databaseColumns({ serversById, jobsById, coverage, biggest, renderActions }: ColumnsInput): ColumnDef<ExplorerDatabase>[] {
    const columns: ColumnDef<ExplorerDatabase>[] = [
        {
            id: "database",
            accessorFn: (database) => database.name,
            header: "Database",
            cell: ({ row }) => {
                const server = serversById.get(row.original.serverId);
                return (
                    <div className="flex min-w-0 items-center gap-3">
                        <DestinationTile destination={{ adapterId: server?.adapterId ?? "" }} />
                        <div className="min-w-0">
                            {/* The keyboard way in, a click anywhere on the row opens it too. */}
                            <Link
                                href={databaseHref(row.original)}
                                className="block truncate rounded-sm font-medium outline-none hover:underline hover:underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring/50"
                            >
                                {row.original.name}
                            </Link>
                            <p className="truncate text-xs text-muted-foreground">{subOf(row.original, server)}</p>
                        </div>
                    </div>
                );
            },
        },
        {
            id: "serverName",
            accessorFn: (database) => serversById.get(database.serverId)?.name ?? "",
            header: "Server",
            cell: ({ row }) => {
                const server = serversById.get(row.original.serverId);
                return (
                    <div className="flex min-w-0 items-center gap-2 text-sm">
                        <span className="truncate">{server?.name}</span>
                        {server && server.status !== "ONLINE" && (
                            <span className={cn("size-1.5 shrink-0 rounded-full", server.status === "OFFLINE" ? "bg-destructive" : "bg-warning")} title={server.status === "OFFLINE" ? "Offline" : "Missed its last check"} />
                        )}
                    </div>
                );
            },
        },
        {
            id: "size",
            accessorFn: (database) => database.sizeInBytes ?? -1,
            header: "Size",
            cell: ({ row }) => {
                const size = row.original.sizeInBytes;
                if (size === null) {
                    const why = row.original.kind === "instance" ? "The server tells no size of its databases" : "The server does not tell the size to this login";
                    return <span className="text-sm text-muted-foreground" title={why}>-</span>;
                }
                return (
                    <div className="min-w-0">
                        <div className="text-sm tabular-nums">{formatBytes(size)}</div>
                        <div className="mt-1.5 h-1.5 w-28 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                            <div className="h-full rounded-full bg-foreground/80" style={{ width: `${Math.max(biggest > 0 ? size / biggest : 0, 0.02) * 100}%` }} />
                        </div>
                    </div>
                );
            },
        },
        {
            id: "tables",
            accessorFn: (database) => database.tableCount ?? -1,
            header: () => <div className="text-right">Tables</div>,
            cell: ({ row }) => (
                <div className={cn("text-right text-sm whitespace-nowrap tabular-nums", row.original.tableCount === null && row.original.kind === "database" && "text-muted-foreground")}>
                    {holdsOf(row.original)}
                </div>
            ),
        },
    ];

    if (coverage) {
        columns.push(
            {
                id: "jobs",
                header: "Backed up by",
                enableSorting: false,
                cell: ({ row }) => <JobsCell jobIds={row.original.jobIds} jobsById={jobsById} />,
            },
            {
                id: "last",
                accessorFn: (database) => (database.lastBackup ? Date.parse(database.lastBackup.at) : 0),
                header: "Last backup",
                cell: ({ row }) => {
                    const last = row.original.lastBackup;
                    if (!last) return <span className="text-sm text-muted-foreground">{row.original.jobIds.length > 0 ? "Not yet" : "Never"}</span>;
                    return (
                        <div className="min-w-0 text-sm">
                            <RelativeTime date={last.at} className="whitespace-nowrap" />
                            <p className="truncate text-xs text-muted-foreground">
                                {jobsById.get(last.jobId)?.name ?? "A deleted job"}
                                {last.size !== null && ` · ${formatBytes(last.size)}`}
                            </p>
                        </div>
                    );
                },
            },
        );
    }

    columns.push(
        { id: "actions", header: "", enableSorting: false, cell: ({ row }) => <div className="flex justify-end">{renderActions(row.original)}</div> },
        // Only here for the filters.
        { id: "server", accessorFn: (database) => database.serverId, filterFn: (row, id, value: string[]) => value.includes(row.getValue(id)) },
        { id: "engine", accessorFn: (database) => serversById.get(database.serverId)?.adapterId ?? "", filterFn: (row, id, value: string[]) => value.includes(row.getValue(id)) },
        {
            id: "job",
            accessorFn: (database) => (database.jobIds.length > 0 ? database.jobIds : ["none"]),
            filterFn: (row, id, value: string[]) => (row.getValue(id) as string[]).some((jobId) => value.includes(jobId)),
        },
        {
            id: "state",
            accessorFn: (database) => statesOf(database, serversById.get(database.serverId), coverage),
            filterFn: (row, id, value: string[]) => (row.getValue(id) as string[]).some((state) => value.includes(state)),
        },
    );
    return columns;
}
