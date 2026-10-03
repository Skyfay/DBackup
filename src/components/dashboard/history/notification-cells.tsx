"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { AdapterIcon } from "@/components/adapter/adapter-icon";
import { ExecutionStatusBadge } from "@/components/dashboard/widgets/execution-status";
import { DateDisplay } from "@/components/utils/date-display";
import { cn } from "@/lib/utils";
import { StartedCell } from "./run-cells";
import { eventLabel, type NotificationLogRow } from "./notification-types";

const TILE = "flex shrink-0 items-center justify-center rounded-lg border bg-muted/50";

export function ChannelTile({ adapterId, size = "md" }: { adapterId: string; size?: "md" | "lg" }) {
    return (
        <span className={cn(TILE, size === "lg" ? "size-11" : "size-8")} aria-hidden="true">
            <AdapterIcon adapterId={adapterId} className={size === "lg" ? "size-5" : "size-4"} />
        </span>
    );
}

export function SentBadge({ ok }: { ok: boolean }) {
    return <ExecutionStatusBadge status={ok ? "Success" : "Failed"} label={ok ? "Sent" : "Failed"} />;
}

export function EventChip({ eventType }: { eventType: string }) {
    return <span className="inline-flex h-5 max-w-full items-center truncate rounded-md bg-muted px-1.5 text-xs font-medium">{eventLabel(eventType)}</span>;
}

/** The columns of the notifications, with the channel and the event also as their filters. */
export function notificationColumns(renderActions: (row: NotificationLogRow) => React.ReactNode): ColumnDef<NotificationLogRow>[] {
    return [
        {
            id: "title",
            accessorFn: (row) => row.title,
            header: "Notification",
            enableSorting: false,
            cell: ({ row }) => (
                <div className="flex min-w-0 items-center gap-3">
                    <ChannelTile adapterId={row.original.adapterId} />
                    <div className="min-w-0">
                        <p className="truncate font-medium">{row.original.title}</p>
                        <p className="truncate text-xs text-muted-foreground">{row.original.channelName}</p>
                    </div>
                </div>
            ),
        },
        { id: "event", accessorFn: (row) => row.eventType, header: "Event", enableSorting: false, cell: ({ row }) => <EventChip eventType={row.original.eventType} /> },
        {
            id: "channel",
            accessorFn: (row) => row.channelName,
            header: "Channel",
            enableSorting: false,
            cell: ({ row }) => (
                <span className="flex min-w-0 items-center gap-2 text-sm">
                    <AdapterIcon adapterId={row.original.adapterId} className="size-4 shrink-0" />
                    <span className="truncate">{row.original.channelName}</span>
                </span>
            ),
        },
        {
            id: "status",
            accessorFn: (row) => row.status,
            header: "Status",
            enableSorting: false,
            cell: ({ row }) => (
                <div className="min-w-0">
                    <SentBadge ok={row.original.status === "Success"} />
                    {row.original.error && <p className="mt-1 truncate text-xs text-destructive" title={row.original.error}>{row.original.error}</p>}
                </div>
            ),
        },
        { id: "sent", accessorFn: (row) => row.sentAt, header: "Sent", enableSorting: false, cell: ({ row }) => <StartedCell startedAt={row.original.sentAt} /> },
        { id: "actions", header: "", enableSorting: false, cell: ({ row }) => <div className="flex justify-end">{renderActions(row.original)}</div> },
    ];
}

/** A notification on a phone. The whole card opens its message. */
export function NotificationCard({ row, onOpen, actions }: { row: NotificationLogRow; onOpen: () => void; actions: React.ReactNode }) {
    return (
        <div className="relative min-w-0 rounded-xl border bg-card p-4 shadow-sm has-[button:focus-visible]:bg-muted/50">
            <div className="flex items-center gap-3">
                <ChannelTile adapterId={row.adapterId} />
                <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left outline-none after:absolute after:inset-0">
                    <span className="block truncate font-medium">{row.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">{row.channelName}</span>
                </button>
                <div className="relative z-10">{actions}</div>
            </div>
            <div className="mt-3 flex min-w-0 items-center gap-2">
                <SentBadge ok={row.status === "Success"} />
                <EventChip eventType={row.eventType} />
                <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums"><DateDisplay date={row.sentAt} format="Pp" /></span>
            </div>
            {row.error && <p className="mt-2 rounded-md bg-destructive/10 px-2 py-1.5 font-mono text-xs break-words text-destructive">{row.error}</p>}
        </div>
    );
}
