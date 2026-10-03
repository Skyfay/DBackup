"use client";

import Link from "next/link";
import { kindNames } from "@/components/adapter/connection-columns";
import { DestinationTile } from "@/components/dashboard/storage/explorer/explorer-cells";
import { count } from "@/components/dashboard/storage/explorer/explorer-format";
import { formatBytes } from "@/lib/utils";
import { DatabasesCell, ServerStatus, VersionLine } from "./server-columns";
import type { ServerRow } from "./server-model";

interface ServerCardProps {
    row: ServerRow;
    /** Whether the viewer may see jobs, which the share in a job needs. */
    coverage: boolean;
    /** Whether the viewer may see backups, which the kept backups need. */
    backups: boolean;
    href: string;
    actions: React.ReactNode;
}

/** A server on a phone, which has no room for the table. The whole card opens its page. */
export function ServerCard({ row, coverage, backups, href, actions }: ServerCardProps) {
    const { server, summary } = row;
    const kept = summary?.keptBackups ?? 0;
    return (
        <div className="relative min-w-0 rounded-xl border bg-card p-4 shadow-sm has-[a:focus-visible]:bg-muted/50">
            <div className="flex items-center gap-3">
                <DestinationTile destination={{ adapterId: server.adapterId }} />
                <Link href={href} className="min-w-0 flex-1 outline-none after:absolute after:inset-0">
                    <span className="block truncate font-medium">{server.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{summary?.address ?? " "}</span>
                </Link>
                <div className="relative z-10">{actions}</div>
            </div>
            <div className="mt-3 flex items-start justify-between gap-3">
                <div className="min-w-0 text-sm">
                    <p className="truncate font-medium">{kindNames.get(server.adapterId) ?? server.adapterId} {server.version}</p>
                    <p className="truncate text-xs text-muted-foreground"><VersionLine row={row} /></p>
                </div>
                <div className="shrink-0"><ServerStatus row={row} /></div>
            </div>
            <div className="mt-3 flex items-end justify-between gap-3">
                {/* Without the share in a job the bare number would say nothing on its own. */}
                {coverage || row.instance ? <DatabasesCell row={row} coverage={coverage} /> : <span className="text-sm">{count(row.databases.length, "database")}</span>}
                <div className="shrink-0 text-right">
                    {row.size !== null && <p className="text-sm tabular-nums">{formatBytes(row.size)}</p>}
                    {backups && <p className="text-xs text-muted-foreground tabular-nums">{kept > 0 ? `${kept.toLocaleString()} kept` : "none kept"}</p>}
                </div>
            </div>
        </div>
    );
}
