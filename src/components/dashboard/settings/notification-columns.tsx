"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Pencil, Send } from "lucide-react";
import type { BackupActionGroup } from "@/components/dashboard/storage/explorer/backup-actions";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import type { AdapterListItemDTO } from "@/lib/adapters/dto";
import { cn } from "@/lib/utils";
import type { NotificationEventRow } from "@/services/notifications/notification-settings-service";
import { ChannelLogos } from "./notification-channels";
import { AREAS, reminderText } from "./notification-words";

export interface NotificationHandlers {
    onEdit?: (event: NotificationEventRow) => void;
    onTest?: (event: NotificationEventRow) => void;
    onSwitch?: (event: NotificationEventRow, enabled: boolean) => void;
}

/** Everything one event can have done to it, for the button at the end of its row and the right click. */
export function notificationActions(event: NotificationEventRow, handlers: NotificationHandlers): BackupActionGroup[] {
    const actions = [
        ...(handlers.onEdit ? [{ id: "edit", label: "Edit", icon: Pencil, onSelect: () => handlers.onEdit?.(event), tone: "edit" as const }] : []),
        ...(handlers.onTest ? [{ id: "test", label: "Send a test", icon: Send, onSelect: () => handlers.onTest?.(event), tone: "neutral" as const }] : []),
    ];
    return actions.length > 0 ? [{ label: "Manage", actions }] : [];
}

export function EventTile({ event, className }: { event: Pick<NotificationEventRow, "category">; className?: string }) {
    const Icon = AREAS[event.category].icon;
    return (
        <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted/50", className)} aria-hidden="true">
            <Icon className="size-4 text-muted-foreground" />
        </span>
    );
}

function GoesTo({ event, channels }: { event: NotificationEventRow; channels: AdapterListItemDTO[] }) {
    if (!event.enabled) return <span className="text-sm text-muted-foreground">Off</span>;
    // An event that is on but has nowhere to go reports nothing, which the row says in amber.
    if (channels.length === 0) return <span className="text-sm text-warning">Nowhere yet</span>;
    return (
        <div className="flex min-w-0 items-center gap-2">
            <ChannelLogos channels={channels} />
            <span className="truncate text-sm">{channels.map((channel) => channel.name).join(", ")}</span>
            {event.channels ? <Badge variant="secondary" className="shrink-0">own</Badge> : <span className="shrink-0 text-xs text-muted-foreground">default</span>}
        </div>
    );
}

interface ColumnOptions {
    handlers: NotificationHandlers;
    /** The channels each event goes to now. */
    channelsOf: (event: NotificationEventRow) => AdapterListItemDTO[];
    /** The event whose switch is being saved. */
    switching: string | null;
    renderActions: (event: NotificationEventRow) => React.ReactNode;
}

/** The columns of the notification events. */
export function notificationColumns({ handlers, channelsOf, switching, renderActions }: ColumnOptions): ColumnDef<NotificationEventRow>[] {
    return [
        {
            accessorKey: "name",
            header: "Event",
            filterFn: (row, _id, value: string) => {
                const query = value.trim().toLowerCase();
                const { name, description, category } = row.original;
                return !query || `${name} ${description} ${AREAS[category].label}`.toLowerCase().includes(query);
            },
            cell: ({ row }) => (
                <div className="flex min-w-0 items-center gap-3">
                    <EventTile event={row.original} />
                    <div className="min-w-0 max-w-md">
                        {handlers.onEdit ? (
                            <button type="button" onClick={() => handlers.onEdit?.(row.original)} className="truncate text-left text-sm font-medium outline-none hover:underline focus-visible:underline">
                                {row.original.name}
                            </button>
                        ) : (
                            <p className="truncate text-sm font-medium">{row.original.name}</p>
                        )}
                        <p className="truncate text-xs text-muted-foreground" title={row.original.description}>
                            {AREAS[row.original.category].label} · {row.original.description}
                            {row.original.notifyUser === "also" ? " · also tells the user" : row.original.notifyUser === "only" ? " · tells only the user" : ""}
                        </p>
                    </div>
                </div>
            ),
        },
        {
            id: "goesTo",
            header: "Goes to",
            enableSorting: false,
            cell: ({ row }) => <div className="w-64"><GoesTo event={row.original} channels={channelsOf(row.original)} /></div>,
        },
        {
            id: "reminder",
            header: "Reminder",
            enableSorting: false,
            cell: ({ row }) => <span className={cn("text-sm", (!row.original.enabled || !row.original.supportsReminder) && "text-muted-foreground")}>{row.original.enabled ? reminderText(row.original) : "-"}</span>,
        },
        {
            id: "enabled",
            header: "On",
            accessorFn: (event) => (event.enabled ? 1 : 0),
            cell: ({ row }) => (
                <Switch
                    checked={row.original.enabled}
                    onCheckedChange={(checked) => handlers.onSwitch?.(row.original, checked)}
                    disabled={!handlers.onSwitch || switching === row.original.id}
                    aria-label={`Report ${row.original.name}`}
                />
            ),
        },
        {
            id: "actions",
            header: () => <span className="sr-only">Actions</span>,
            enableSorting: false,
            enableHiding: false,
            cell: ({ row }) => <div className="flex justify-end gap-0.5">{renderActions(row.original)}</div>,
        },
    ];
}
