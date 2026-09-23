"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { RunBars } from "@/components/dashboard/widgets/run-bars";
import { DateDisplay } from "@/components/utils/date-display";
import type { JobListItem } from "@/services/jobs/job-list-service";
import { FlowCell, JobNameCell, LastRunCell, NextRun } from "./job-cells";
import { retentionLabel } from "./job-retention";

interface ColumnOptions {
    renderActions: (job: JobListItem) => React.ReactNode;
    /** Opens the details panel of a job. */
    onOpen?: (job: JobListItem) => void;
}

const Muted = ({ children }: { children: React.ReactNode }) => <span className="text-sm text-muted-foreground">{children}</span>;

/**
 * The columns of the job table. Name and actions stay put, everything in between can be moved
 * and switched off in the Columns menu, and some start switched off.
 */
export function jobColumns({ renderActions, onOpen }: ColumnOptions): ColumnDef<JobListItem>[] {
    return [
        {
            accessorKey: "name",
            header: "Job",
            meta: { pin: "start" },
            cell: ({ row, table }) => (
                <JobNameCell job={row.original} compact={table.options.meta?.density === "compact"} onOpen={onOpen ? () => onOpen(row.original) : undefined} />
            ),
        },
        {
            id: "lastRun",
            header: "Last run",
            cell: ({ row }) => <LastRunCell job={row.original} />,
        },
        {
            id: "runs",
            header: "Last 12 runs",
            cell: ({ row }) => <RunBars runs={row.original.overview.runs} />,
        },
        {
            id: "flow",
            header: "What goes where",
            cell: ({ row }) => <FlowCell job={row.original} />,
        },
        {
            id: "next",
            header: "Next run",
            cell: ({ row }) => (
                <span className="text-sm tabular-nums">
                    <NextRun job={row.original} />
                </span>
            ),
        },
        {
            id: "retention",
            header: "Keeps",
            meta: { defaultHidden: true },
            cell: ({ row }) => {
                const labels = [...new Set(row.original.destinations.map(retentionLabel))];
                return labels.length > 0 ? <span className="block max-w-56 truncate text-sm">{labels.join(", ")}</span> : <Muted>-</Muted>;
            },
        },
        {
            id: "notifications",
            header: "Notifies",
            meta: { defaultHidden: true },
            cell: ({ row }) => {
                const names = [
                    ...row.original.notificationTemplates.map((entry) => entry.template.name),
                    ...(row.original.notificationTemplates.length === 0 ? row.original.notifications.map((channel) => channel.name) : []),
                ];
                return names.length > 0 ? <span className="block max-w-56 truncate text-sm">{names.join(", ")}</span> : <Muted>Nobody</Muted>;
            },
        },
        {
            accessorKey: "createdAt",
            header: "Added",
            meta: { defaultHidden: true },
            cell: ({ row }) => <span className="text-sm"><DateDisplay date={row.original.createdAt} format="P" /></span>,
        },
        {
            id: "actions",
            header: () => <span className="sr-only">Actions</span>,
            meta: { pin: "end", label: "Actions" },
            enableHiding: false,
            cell: ({ row }) => <div className="flex justify-end">{renderActions(row.original)}</div>,
        },
    ];
}
