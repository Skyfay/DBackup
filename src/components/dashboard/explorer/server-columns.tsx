"use client";

import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { kindNames } from "@/components/adapter/connection-columns";
import { DestinationTile } from "@/components/dashboard/storage/explorer/explorer-cells";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { DateDisplay } from "@/components/utils/date-display";
import { cn, formatBytes } from "@/lib/utils";
import type { ExplorerServer } from "@/services/databases/database-explorer-types";
import { compactCount } from "./database-model";
import { serverHref, type ServerRow } from "./server-model";

const STATUS: Record<ExplorerServer["status"], { label: string; dot: string }> = {
    ONLINE: { label: "Online", dot: "bg-success" },
    DEGRADED: { label: "Missed a check", dot: "bg-warning" },
    OFFLINE: { label: "Offline", dot: "bg-destructive" },
};

/** The version a server runs, and since when, or which newer backups of its engine it cannot take. */
export function VersionLine({ row }: { row: Pick<ServerRow, "server" | "summary"> }) {
    const { server, summary } = row;
    if (summary?.behind) return <span className="text-warning">behind {summary.behind.serverName}, {summary.behind.version}</span>;
    if (!server.versionSince) return <>no change seen</>;
    return (
        <>
            since <DateDisplay date={server.versionSince} format="P" />
            {server.previousVersion && `, ${server.previousVersion} before`}
        </>
    );
}

/** How much of a server a job backs up, as a share in green with the rest in amber. */
function CoverageBar({ covered, total }: { covered: number; total: number }) {
    if (total === 0) return null;
    return (
        <div className="mt-1.5 flex h-1.5 w-28 overflow-hidden rounded-full bg-muted" aria-hidden="true">
            <div className="h-full bg-success" style={{ width: `${(covered / total) * 100}%` }} />
            <div className="h-full bg-warning/70" style={{ width: `${((total - covered) / total) * 100}%` }} />
        </div>
    );
}

/** The databases of a server with how many a job backs up, or the keys of a Redis or Valkey server. */
export function DatabasesCell({ row, coverage }: { row: ServerRow; coverage: boolean }) {
    if (row.instance) {
        const total = row.instance.logical.length + row.instance.emptyLogical;
        return (
            <div className="min-w-0 text-sm">
                <p className="tabular-nums">{compactCount(row.instance.keyCount ?? 0)} keys</p>
                <p className="truncate text-xs text-muted-foreground">in {row.instance.logical.length} of {total} databases</p>
            </div>
        );
    }
    if (!coverage) return <span className="text-sm tabular-nums">{row.databases.length.toLocaleString()}</span>;
    return (
        <div className="min-w-0 text-sm">
            <p className="tabular-nums">
                {row.covered.toLocaleString()} <span className="text-muted-foreground">of {row.databases.length.toLocaleString()} in a job</span>
            </p>
            <CoverageBar covered={row.covered} total={row.databases.length} />
        </div>
    );
}

/** Whether a server answers, with the time of its last health check. */
export function ServerStatus({ row }: { row: Pick<ServerRow, "server" | "summary"> }) {
    const status = STATUS[row.server.status];
    const latency = row.summary?.latencyMs;
    return (
        <span className="flex items-center gap-2 text-sm whitespace-nowrap">
            <span className={cn("size-1.5 shrink-0 rounded-full", status.dot)} aria-hidden="true" />
            {status.label}
            {latency != null && row.server.status === "ONLINE" && <span className="text-xs text-muted-foreground tabular-nums">{latency} ms</span>}
        </span>
    );
}

interface ColumnsInput {
    /** Whether the viewer may see jobs, which the share in a job needs. */
    coverage: boolean;
    /** Whether the viewer may see backups, which the kept backups need. */
    backups: boolean;
    /** The size of the biggest server, the full length of the bars. */
    biggest: number;
    renderActions: (row: ServerRow) => React.ReactNode;
}

/** The columns of the list of servers, with the engine only for its filter. */
export function serverColumns({ coverage, backups, biggest, renderActions }: ColumnsInput): ColumnDef<ServerRow>[] {
    const columns: ColumnDef<ServerRow>[] = [
        {
            id: "server",
            accessorFn: (row) => row.server.name,
            header: "Server",
            cell: ({ row }) => (
                <div className="flex min-w-0 items-center gap-3">
                    <DestinationTile destination={{ adapterId: row.original.server.adapterId }} />
                    <div className="min-w-0">
                        {/* The keyboard way in, a click anywhere on the row opens it too. */}
                        <Link
                            href={serverHref(row.original.server.id)}
                            className="block truncate rounded-sm font-medium outline-none hover:underline hover:underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring/50"
                        >
                            {row.original.server.name}
                        </Link>
                        <p className="truncate text-xs text-muted-foreground">{row.original.summary?.address ?? " "}</p>
                    </div>
                </div>
            ),
        },
        {
            id: "version",
            accessorFn: (row) => row.server.version ?? "",
            header: "Version",
            cell: ({ row }) => (
                <div className="min-w-0 text-sm">
                    <p className="truncate font-medium">{kindNames.get(row.original.server.adapterId) ?? row.original.server.adapterId} {row.original.server.version}</p>
                    <p className="truncate text-xs text-muted-foreground"><VersionLine row={row.original} /></p>
                </div>
            ),
        },
        {
            id: "databases",
            accessorFn: (row) => row.databases.length,
            header: "Databases",
            cell: ({ row }) => <DatabasesCell row={row.original} coverage={coverage} />,
        },
        {
            id: "size",
            accessorFn: (row) => row.size ?? -1,
            header: "Stored",
            cell: ({ row }) => {
                const size = row.original.size;
                if (size === null) return <span className="text-sm text-muted-foreground" title="The server does not tell the sizes to this login">-</span>;
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
    ];

    if (backups) {
        columns.push({
            id: "backups",
            accessorFn: (row) => row.summary?.keptBackups ?? -1,
            header: "Backups",
            cell: ({ row }) => {
                const kept = row.original.summary?.keptBackups ?? 0;
                if (kept === 0) return <span className="text-sm text-muted-foreground">none kept</span>;
                return (
                    <div className="min-w-0 text-sm">
                        <p className="tabular-nums">{kept.toLocaleString()} kept</p>
                        {row.original.summary?.lastBackupAt && (
                            <p className="truncate text-xs text-muted-foreground">the last <RelativeTime date={row.original.summary.lastBackupAt} /></p>
                        )}
                    </div>
                );
            },
        });
    }

    columns.push(
        {
            id: "status",
            accessorFn: (row) => row.server.status,
            header: "Status",
            cell: ({ row }) => <ServerStatus row={row.original} />,
        },
        { id: "actions", header: "", enableSorting: false, cell: ({ row }) => <div className="flex justify-end">{renderActions(row.original)}</div> },
        // Only here for the filter.
        { id: "engine", accessorFn: (row) => row.server.adapterId, filterFn: (row, id, value: string[]) => value.includes(row.getValue(id)) },
    );
    return columns;
}
