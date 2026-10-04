"use client";

import { useState } from "react";
import { Bell, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { saveDefaultChannelsAction, saveNotificationEventsAction } from "@/app/actions/settings/notification-settings";
import { ChoiceCards } from "@/components/adapter/connection-mode-choice";
import { Button } from "@/components/ui/button";
import { DIALOG_FOOTER, DIALOG_SURFACE, DialogHead, DialogItemList, dialogNoteClass } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { BulkDialogProps } from "@/components/ui/data-table-types";
import type { AdapterListItemDTO } from "@/lib/adapters/dto";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { cn } from "@/lib/utils";
import type { NotificationEventRow } from "@/services/notifications/notification-settings-service";
import { ChannelChecklist } from "./notification-channels";
import { AREAS } from "./notification-words";

const log = logger.child({ component: "notification-bulk" });

interface SendToDialogProps extends BulkDialogProps<NotificationEventRow> {
    channels: AdapterListItemDTO[];
    defaultChannels: string[];
}

/** Send to of several ticked events at once: the default channels, or the same own channels for all of them. */
export function SendToDialog({ rows, onClose, onDone, channels, defaultChannels }: SendToDialogProps) {
    const [own, setOwn] = useState(false);
    const [picked, setPicked] = useState<string[]>(defaultChannels);
    const [saving, setSaving] = useState(false);
    const [problem, setProblem] = useState<string | null>(null);
    const ids = rows.map((row) => row.id);
    const noun = rows.length === 1 ? "1 event" : `${rows.length} events`;

    const save = async () => {
        if (own && picked.length === 0) return setProblem("Pick at least one channel, or send them to the default channels.");
        setSaving(true);
        try {
            const result = await saveNotificationEventsAction(ids, { channels: own ? picked : null });
            onDone(result.success ? { succeeded: ids, failed: [] } : { succeeded: [], failed: rows.map((row) => ({ id: row.id, name: row.name, error: result.error })) });
        } catch (error: unknown) {
            log.warn("Saving where several events go failed", { count: ids.length }, wrapError(error));
            onDone({ succeeded: [], failed: rows.map((row) => ({ id: row.id, name: row.name, error: "The events could not be saved." })) });
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
            <DialogContent tone="edit" showCloseButton={false} className={cn(DIALOG_SURFACE, "sm:max-w-xl")}>
                <DialogHead tone="edit" icon={Send}>
                    <DialogTitle className="text-base">Send {noun} to</DialogTitle>
                    <DialogDescription className={dialogNoteClass("edit")}>Their reminders and the rest stay as they are</DialogDescription>
                </DialogHead>
                <ScrollArea className="*:data-[slot=scroll-area-viewport]:max-h-[calc(90dvh-9rem)]">
                    <div className="space-y-4 p-5">
                        <DialogItemList size="small" items={rows.map((row) => ({ name: row.name, detail: AREAS[row.category].label, icon: AREAS[row.category].icon }))} />
                        <ChoiceCards
                            value={own ? "own" : "default"}
                            onValueChange={(mode) => {
                                setOwn(mode === "own");
                                setProblem(null);
                            }}
                            aria-label="Send them to"
                            options={[
                                { value: "default", title: "The default channels", description: "And what the default channels get later." },
                                { value: "own", title: "The same own channels", description: "Only the channels ticked below, for all of them." },
                            ]}
                        />
                        {own && channels.length > 0 && <ChannelChecklist channels={channels} value={picked} onChange={(next) => { setPicked(next); setProblem(null); }} />}
                        {problem && <p className="text-xs text-destructive">{problem}</p>}
                    </div>
                </ScrollArea>
                <div className={cn(DIALOG_FOOTER, "flex justify-end gap-2")}>
                    <Button variant="outline" onClick={onClose} disabled={saving}>
                        Cancel
                    </Button>
                    <Button onClick={() => void save()} disabled={saving}>
                        {saving && <Loader2 className="animate-spin" />}
                        Save {noun}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}

interface DefaultChannelsDialogProps {
    open: boolean;
    channels: AdapterListItemDTO[];
    value: string[];
    onOpenChange: (open: boolean) => void;
    onSaved: () => void;
}

/** The channels every event goes to unless it has its own. */
export function DefaultChannelsDialog({ open, channels, value, onOpenChange, onSaved }: DefaultChannelsDialogProps) {
    const [picked, setPicked] = useState(value);
    const [saving, setSaving] = useState(false);

    const save = async () => {
        setSaving(true);
        try {
            const result = await saveDefaultChannelsAction(picked);
            if (!result.success) {
                toast.error(result.error);
                return;
            }
            toast.success("Default channels saved");
            onSaved();
            onOpenChange(false);
        } catch (error: unknown) {
            log.warn("Saving the default channels failed", {}, wrapError(error));
            toast.error("The default channels could not be saved.");
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (saving) return;
                if (next) setPicked(value);
                onOpenChange(next);
            }}
        >
            <DialogContent tone="edit" showCloseButton={false} className={cn(DIALOG_SURFACE, "sm:max-w-lg")}>
                <DialogHead tone="edit" icon={Bell}>
                    <DialogTitle className="text-base">Default channels</DialogTitle>
                    <DialogDescription className={dialogNoteClass("edit")}>Every event without channels of its own goes here</DialogDescription>
                </DialogHead>
                <ScrollArea className="*:data-[slot=scroll-area-viewport]:max-h-[calc(90dvh-9rem)]">
                    <div className="space-y-3 p-5">
                        {channels.length === 0 ? (
                            <p className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">There is no notification channel yet. Add one first.</p>
                        ) : (
                            <ChannelChecklist channels={channels} value={picked} onChange={setPicked} />
                        )}
                        <p className="text-xs text-muted-foreground">With none ticked, only the events with channels of their own send anything.</p>
                    </div>
                </ScrollArea>
                <div className={cn(DIALOG_FOOTER, "flex justify-end gap-2")}>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
                        Cancel
                    </Button>
                    <Button onClick={() => void save()} disabled={saving || channels.length === 0}>
                        {saving && <Loader2 className="animate-spin" />}
                        Save changes
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
