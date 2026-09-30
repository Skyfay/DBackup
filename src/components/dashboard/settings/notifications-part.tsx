"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, BellOff, Pencil, Plus, Send } from "lucide-react";
import { toast } from "sonner";
import { saveNotificationEventsAction, sendTestNotificationAction } from "@/app/actions/settings/notification-settings";
import { AddConnectionDialogs } from "@/components/adapter/add-connection-dialogs";
import { useCan } from "@/components/permissions/permissions-context";
import { BackupContextMenu, BackupRowMenu } from "@/components/dashboard/storage/explorer/backup-menus";
import { Button } from "@/components/ui/button";
import { DataTable, type BulkAction } from "@/components/ui/data-table";
import { QuickFilter } from "@/components/ui/quick-filter";
import type { AdapterListItemDTO } from "@/lib/adapters/dto";
import { PERMISSIONS } from "@/lib/auth/permissions";
import type { BulkResult } from "@/lib/core/bulk";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import type { NotificationEventRow, NotificationsModel } from "@/services/notifications/notification-settings-service";
import { DefaultChannelsDialog, SendToDialog } from "./notification-bulk";
import { ChannelLogos } from "./notification-channels";
import { EventTile, notificationActions, notificationColumns, type NotificationHandlers } from "./notification-columns";
import { NotificationDialog } from "./notification-dialog";
import { AREAS, channelsOf } from "./notification-words";
import { PartFrame, useSettingsFrame } from "./settings-frame";

const log = logger.child({ component: "notifications-part" });

type EventFilter = "all" | "on" | "off" | "own" | "nowhere";

/** The default channels on top: where every event goes unless it has its own. */
function DefaultsStrip({ channels, onChange }: { channels: AdapterListItemDTO[]; onChange?: () => void }) {
    return (
        <div className="flex flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-center md:px-6">
            <div className="flex min-w-0 flex-1 items-center gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted/50" aria-hidden="true">
                    <Bell className="size-4 text-muted-foreground" />
                </span>
                <div className="min-w-0">
                    <p className="text-sm font-semibold">Default channels</p>
                    <p className="text-xs text-muted-foreground">Every event goes here unless it has its own</p>
                </div>
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
                {channels.length === 0 ? (
                    <span className="text-sm text-warning">None yet</span>
                ) : (
                    channels.map((channel) => (
                        <span key={channel.id} className="inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium">
                            <ChannelLogos channels={[channel]} />
                            {channel.name}
                        </span>
                    ))
                )}
                {onChange && (
                    <Button variant="outline" size="sm" onClick={onChange}>
                        <Pencil />
                        Change
                    </Button>
                )}
            </div>
        </div>
    );
}

/**
 * Every system event as a row with the logos of where it goes, its reminder and its switch, like
 * the system tasks. A row opens its Edit dialog, and ticked rows go on, off or to other channels
 * together, so a change of many events needs no dialog per event.
 */
export function NotificationsPart({ model, openEventId, onOpened }: { model: NotificationsModel; openEventId: string | null; onOpened: () => void }) {
    const router = useRouter();
    const { readOnly } = useSettingsFrame();
    const canAddChannel = useCan(PERMISSIONS.NOTIFICATIONS.WRITE) && !readOnly;
    const [filter, setFilter] = useState<EventFilter>("all");
    const [editing, setEditing] = useState<string | null>(null);
    const [switching, setSwitching] = useState<string | null>(null);
    const [changingDefaults, setChangingDefaults] = useState(false);
    const [adding, setAdding] = useState(false);

    // An event the search picked opens its Edit dialog right away.
    useEffect(() => {
        if (!openEventId) return;
        setEditing(openEventId);
        onOpened();
    }, [openEventId, onOpened]);

    const byId = useMemo(() => new Map(model.channels.map((channel) => [channel.id, channel])), [model.channels]);
    const known = useMemo(() => new Set(byId.keys()), [byId]);
    const channelsFor = useCallback(
        (event: NotificationEventRow) => channelsOf(event, model.defaultChannels, known).map((id) => byId.get(id)!),
        [model.defaultChannels, known, byId]
    );
    const nowhere = useCallback((event: NotificationEventRow) => event.enabled && channelsFor(event).length === 0, [channelsFor]);

    const test = useCallback(async (event: NotificationEventRow) => {
        const toastId = toast.loading(`Sending a test of ${event.name}`);
        try {
            const result = await sendTestNotificationAction(event.id);
            if (result.success) toast.success(result.message ?? "Test sent", { id: toastId });
            else toast.error(result.error ?? "The test could not be sent.", { id: toastId });
        } catch (error: unknown) {
            log.warn("Sending a test notification failed", { eventId: event.id }, wrapError(error));
            toast.error("The test could not be sent.", { id: toastId });
        }
    }, []);

    const switchEvent = useCallback(async (event: NotificationEventRow, enabled: boolean) => {
        setSwitching(event.id);
        try {
            const result = await saveNotificationEventsAction([event.id], { enabled });
            if (!result.success) toast.error(result.error);
            else router.refresh();
        } catch (error: unknown) {
            log.warn("Switching a notification event failed", { eventId: event.id }, wrapError(error));
            toast.error(`${event.name} could not be switched.`);
        } finally {
            setSwitching(null);
        }
    }, [router]);

    const handlers = useMemo<NotificationHandlers>(
        () => (readOnly ? { onTest: undefined } : { onEdit: (event) => setEditing(event.id), onTest: (event) => void test(event), onSwitch: (event, enabled) => void switchEvent(event, enabled) }),
        [readOnly, test, switchEvent]
    );

    const columns = useMemo(() => notificationColumns({
        handlers,
        channelsOf: channelsFor,
        switching,
        renderActions: (event) => (
            <>
                {handlers.onTest && event.enabled && (
                    <Button variant="ghost" className="size-8 p-0" onClick={() => handlers.onTest?.(event)} aria-label={`Send a test of ${event.name}`}>
                        <Send />
                    </Button>
                )}
                <BackupRowMenu name={event.name} groups={notificationActions(event, handlers)} />
            </>
        ),
    }), [handlers, channelsFor, switching]);

    // What the ticked events do together, one save for all of them.
    const bulkActions = useMemo<BulkAction<NotificationEventRow>[]>(() => {
        if (readOnly) return [];
        const switchAll = (enabled: boolean) => async (rows: NotificationEventRow[]): Promise<BulkResult> => {
            const ids = rows.map((row) => row.id);
            const result = await saveNotificationEventsAction(ids, { enabled });
            router.refresh();
            return result.success ? { succeeded: ids, failed: [] } : { succeeded: [], failed: rows.map((row) => ({ id: row.id, name: row.name, error: result.error })) };
        };
        return [
            {
                id: "send-to",
                labels: { verb: "save where to send", verbPast: "saved", noun: "event" },
                label: () => "Send to",
                icon: Send,
                tone: "edit",
                itemName: (event) => event.name,
                dialog: ({ rows, onClose, onDone }) => (
                    <SendToDialog rows={rows} onClose={onClose} onDone={(result) => { router.refresh(); onDone(result); }} channels={model.channels} defaultChannels={model.defaultChannels} />
                ),
            },
            {
                id: "on",
                labels: { verb: "switch on", verbPast: "switched on", noun: "event" },
                label: () => "Switch on",
                icon: Bell,
                isAvailable: (rows) => rows.some((row) => !row.enabled),
                itemName: (event) => event.name,
                run: switchAll(true),
            },
            {
                id: "off",
                labels: { verb: "switch off", verbPast: "switched off", noun: "event" },
                label: () => "Switch off",
                icon: BellOff,
                isAvailable: (rows) => rows.some((row) => row.enabled),
                itemName: (event) => event.name,
                run: switchAll(false),
            },
        ];
    }, [readOnly, router, model.channels, model.defaultChannels]);

    const filters: Record<EventFilter, (event: NotificationEventRow) => boolean> = {
        all: () => true,
        on: (event) => event.enabled,
        off: (event) => !event.enabled,
        own: (event) => event.channels !== null,
        nowhere,
    };
    const count = (key: EventFilter) => model.events.filter(filters[key]).length;
    const shown = model.events.filter(filters[filter]);
    const nowhereCount = count("nowhere");
    const event = editing ? model.events.find((entry) => entry.id === editing) ?? null : null;

    return (
        <PartFrame
            part="notifications"
            flush
            action={canAddChannel && (
                <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
                    <Plus />
                    Add a channel
                </Button>
            )}
        >
            <div data-setting="notifications.events">
                <DefaultsStrip channels={model.defaultChannels.map((id) => byId.get(id)).filter((channel): channel is AdapterListItemDTO => !!channel)} onChange={readOnly ? undefined : () => setChangingDefaults(true)} />
                <DataTable
                    variant="card"
                    frameless
                    columns={columns}
                    data={shown}
                    searchKey="name"
                    searchPlaceholder="Search events"
                    getRowId={(entry) => entry.id}
                    enableRowSelection={!readOnly}
                    bulkActions={bulkActions}
                    onRowClick={handlers.onEdit}
                    activeRowId={editing}
                    toolbarExtra={
                        <QuickFilter
                            value={filter}
                            onChange={setFilter}
                            aria-label="Show the events"
                            options={[
                                { value: "all", label: "All", count: model.events.length },
                                { value: "on", label: "On", count: count("on") },
                                { value: "off", label: "Off", count: count("off") },
                                { value: "own", label: "Own channels", count: count("own") },
                                ...(nowhereCount > 0 || filter === "nowhere" ? [{ value: "nowhere" as const, label: "Nowhere", count: nowhereCount, dot: "bg-warning" }] : []),
                            ]}
                        />
                    }
                    renderRowMenu={(entry, bulk) => (
                        <BackupContextMenu tile={<EventTile event={entry} />} title={entry.name} note={AREAS[entry.category].label} groups={notificationActions(entry, handlers)} bulk={bulk} />
                    )}
                />
            </div>

            <NotificationDialog event={event} channels={model.channels} defaultChannels={model.defaultChannels} onOpenChange={(open) => !open && setEditing(null)} onTest={(entry) => void test(entry)} />
            <DefaultChannelsDialog open={changingDefaults} channels={model.channels} value={model.defaultChannels} onOpenChange={setChangingDefaults} onSaved={() => router.refresh()} />
            {canAddChannel && (
                <AddConnectionDialogs open={adding} onOpenChange={setAdding} type="notification" title="Add a notification channel" onSaved={() => router.refresh()} />
            )}
        </PartFrame>
    );
}
