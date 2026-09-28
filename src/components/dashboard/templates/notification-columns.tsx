"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { AdapterIcon } from "@/components/adapter/adapter-icon";
import { OutcomeChips } from "@/components/dashboard/jobs/notification-overview";
import { JobIcon } from "@/components/dashboard/storage/explorer/explorer-cells";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { parseOutcomes } from "@/components/templates/notification-model";
import type { DataTableFilterableColumn } from "@/components/ui/data-table";
import { DateDisplay } from "@/components/utils/date-display";
import type { NotificationRow, TemplateJob } from "@/services/templates/templates-types";
import { BuiltInBadge, DefaultBadge, JobsStack, NameCell } from "./template-cells";
import { count } from "./template-format";

/** The jobs that send through a template. */
export function sendersOf(row: NotificationRow, jobs: Map<string, TemplateJob>): TemplateJob[] {
    return row.jobIds.map((id) => jobs.get(id)).filter((job): job is TemplateJob => job !== undefined);
}

/** Each channel of a template with the runs it hears about. */
export function ChannelRuns({ row }: { row: NotificationRow }) {
    if (row.channels.length === 0) return <span className="text-sm text-muted-foreground">no channel</span>;
    return (
        <ul className="min-w-0 space-y-1">
            {row.channels.map((channel) => (
                <li key={channel.id} className="flex min-w-0 items-center gap-2 text-sm">
                    <AdapterIcon adapterId={channel.config.adapterId} className="size-3.5 shrink-0" />
                    <span className="min-w-0 truncate">{channel.config.name}</span>
                    <span className="shrink-0">
                        <OutcomeChips outcomes={parseOutcomes(channel.events)} />
                    </span>
                </li>
            ))}
        </ul>
    );
}

const channelIdsOf = (row: NotificationRow) => row.channels.map((channel) => channel.configId);

interface ColumnOptions {
    jobs: Map<string, TemplateJob>;
    onOpen: (row: NotificationRow) => void;
    renderActions: (row: NotificationRow) => React.ReactNode;
}

/** The columns of the notification templates. Name and actions stay put, the rest can move and hide. */
export function notificationColumns({ jobs, onOpen, renderActions }: ColumnOptions): ColumnDef<NotificationRow>[] {
    return [
        {
            accessorKey: "name",
            header: "Template",
            meta: { pin: "start" },
            cell: ({ row, table }) => (
                <NameCell
                    kind="notification"
                    name={row.original.name}
                    sub={row.original.description || count(row.original.channels.length, "channel")}
                    badges={row.original.isSystem ? <BuiltInBadge /> : undefined}
                    compact={table.options.meta?.density === "compact"}
                    onOpen={() => onOpen(row.original)}
                />
            ),
        },
        {
            id: "channels",
            header: "Channels and runs",
            // A template counts once for each channel in the numbers of the filter.
            accessorFn: channelIdsOf,
            getUniqueValues: channelIdsOf,
            filterFn: (row, id, value: string[]) => (row.getValue(id) as string[]).some((configId) => value.includes(configId)),
            cell: ({ row }) => <div className="max-w-80"><ChannelRuns row={row.original} /></div>,
        },
        {
            id: "usedBy",
            header: "Used by",
            accessorFn: (row) => row.jobIds,
            getUniqueValues: (row) => row.jobIds,
            filterFn: (row, id, value: string[]) => (row.getValue(id) as string[]).some((jobId) => value.includes(jobId)),
            cell: ({ row }) => {
                const senders = sendersOf(row.original, jobs);
                return (
                    <div className="min-w-0 max-w-72">
                        <JobsStack jobs={senders} />
                        {senders.length > 0 && <p className="mt-0.5 text-xs text-muted-foreground">{count(senders.length, "job")}</p>}
                    </div>
                );
            },
        },
        {
            id: "default",
            header: "Default",
            cell: ({ row }) =>
                row.original.isDefault ? (
                    <div className="min-w-0">
                        <DefaultBadge />
                        <p className="mt-1 text-xs whitespace-nowrap text-muted-foreground">new jobs start with it</p>
                    </div>
                ) : null,
        },
        {
            id: "changed",
            header: "Changed",
            cell: ({ row }) => <RelativeTime date={row.original.updatedAt} className="text-sm whitespace-nowrap text-muted-foreground" />,
        },
        {
            id: "created",
            header: "Created",
            meta: { defaultHidden: true },
            cell: ({ row }) => <span className="text-sm whitespace-nowrap"><DateDisplay date={row.original.createdAt} format="P" /></span>,
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

/** The Channel and Used by filters, with only the values some template has. */
export function notificationFilters(rows: NotificationRow[], jobs: Map<string, TemplateJob>): DataTableFilterableColumn<NotificationRow>[] {
    const shared = { note: "The numbers count the templates", unavailableLabel: "No templates with the other filters" };
    const channels = new Map(rows.flatMap((row) => row.channels.map((channel) => [channel.configId, channel.config] as const)));
    const senders = [...new Set(rows.flatMap((row) => row.jobIds))].map((id) => jobs.get(id)).filter((job): job is TemplateJob => job !== undefined);
    return [
        {
            id: "channels",
            title: "Channel",
            ...shared,
            contentClassName: "w-72",
            options: [...channels.values()]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((channel) => ({ value: channel.id, label: channel.name, lead: <AdapterIcon adapterId={channel.adapterId} className="size-4 shrink-0" /> })),
        },
        {
            id: "usedBy",
            title: "Used by",
            ...shared,
            contentClassName: "w-72",
            options: senders
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((job) => ({
                    value: job.id,
                    label: job.name,
                    lead: <JobIcon job={{ kind: "job", sourceType: job.sourceType, hasFolders: job.hasFolders }} className="size-4 shrink-0" />,
                })),
        },
    ];
}
