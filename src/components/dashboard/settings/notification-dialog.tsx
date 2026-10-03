"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { saveNotificationEventsAction } from "@/app/actions/settings/notification-settings";
import { ChoiceCards } from "@/components/adapter/connection-mode-choice";
import { SwitchList, SwitchRow } from "@/components/adapter/setting-switches";
import { Button } from "@/components/ui/button";
import { DIALOG_FOOTER, DIALOG_SURFACE, DialogHead, dialogNoteClass } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { AdapterListItemDTO } from "@/lib/adapters/dto";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import type { NotifyUserMode } from "@/lib/notifications/types";
import { cn } from "@/lib/utils";
import type { NotificationEventRow } from "@/services/notifications/notification-settings-service";
import { ChannelChecklist } from "./notification-channels";
import { AREAS, REMINDER_CHOICES, everyText } from "./notification-words";

const log = logger.child({ component: "notification-dialog" });

interface Values {
    enabled: boolean;
    own: boolean;
    channels: string[];
    notifyUser: NotifyUserMode;
    /** "default", "0" or hours. */
    reminder: string;
}

interface NotificationDialogProps {
    event: NotificationEventRow | null;
    channels: AdapterListItemDTO[];
    defaultChannels: string[];
    onOpenChange: (open: boolean) => void;
    onTest: (event: NotificationEventRow) => void;
}

/** Edit of a notification event: on or off, the default or its own channels, the user, and the reminder. */
export function NotificationDialog({ event, channels, defaultChannels, onOpenChange, onTest }: NotificationDialogProps) {
    const [saving, setSaving] = useState(false);
    return (
        <Dialog open={event !== null} onOpenChange={(open) => !saving && onOpenChange(open)}>
            <DialogContent tone="edit" showCloseButton={false} className={cn(DIALOG_SURFACE, "sm:max-w-2xl")}>
                {event && (
                    <EventForm
                        key={event.id}
                        event={event}
                        channels={channels}
                        defaultChannels={defaultChannels}
                        saving={saving}
                        onSavingChange={setSaving}
                        onClose={() => onOpenChange(false)}
                        onTest={onTest}
                    />
                )}
            </DialogContent>
        </Dialog>
    );
}

interface EventFormProps {
    event: NotificationEventRow;
    channels: AdapterListItemDTO[];
    defaultChannels: string[];
    saving: boolean;
    onSavingChange: (saving: boolean) => void;
    onClose: () => void;
    onTest: (event: NotificationEventRow) => void;
}

function EventForm({ event, channels, defaultChannels, saving, onSavingChange, onClose, onTest }: EventFormProps) {
    const router = useRouter();
    const [initial] = useState<Values>(() => ({
        enabled: event.enabled,
        own: event.channels !== null,
        // Own channels start from the default ones, so switching over is one untick away.
        channels: event.channels ?? defaultChannels,
        notifyUser: event.notifyUser ?? "none",
        reminder: event.reminderHours === null ? "default" : String(event.reminderHours),
    }));
    const [values, setValues] = useState(initial);
    const [problem, setProblem] = useState<string | null>(null);
    const dirty = JSON.stringify(values) !== JSON.stringify(initial);
    const area = AREAS[event.category];
    const names = (ids: string[]) => channels.filter((channel) => ids.includes(channel.id)).map((channel) => channel.name).join(", ");
    const defaultNames = names(defaultChannels) || "no channel yet";
    const reminderChoices = [...new Set([...REMINDER_CHOICES, ...(values.reminder === "default" || values.reminder === "0" ? [] : [Number(values.reminder)])])].sort((a, b) => a - b);

    const set = <K extends keyof Values>(key: K, value: Values[K]) => {
        setValues((current) => ({ ...current, [key]: value }));
        setProblem(null);
    };

    const submit = async (formEvent: React.FormEvent) => {
        formEvent.preventDefault();
        if (!dirty) return onClose();
        if (values.own && values.channels.length === 0) return setProblem("Pick at least one channel, or send it to the default channels.");
        onSavingChange(true);
        try {
            const result = await saveNotificationEventsAction([event.id], {
                enabled: values.enabled,
                channels: values.own ? values.channels : null,
                ...(event.notifyUser !== null ? { notifyUser: values.notifyUser } : {}),
                ...(event.supportsReminder ? { reminderHours: values.reminder === "default" ? null : Number(values.reminder) } : {}),
            });
            if (!result.success) {
                setProblem(result.error);
                toast.error(result.error);
                return;
            }
            toast.success(`${event.name} saved`);
            router.refresh();
            onClose();
        } catch (error: unknown) {
            log.warn("Saving a notification event failed", { eventId: event.id }, wrapError(error));
            toast.error("The event could not be saved.");
        } finally {
            onSavingChange(false);
        }
    };

    return (
        <form onSubmit={(formEvent) => void submit(formEvent)} noValidate className="flex min-h-0 flex-1 flex-col">
            <DialogHead tone="edit" icon={area.icon}>
                <DialogTitle className="truncate text-base">Edit {event.name}</DialogTitle>
                <DialogDescription className={dialogNoteClass("edit")}>A change applies to the next event</DialogDescription>
            </DialogHead>

            <ScrollArea className="min-h-0 flex-1 *:data-[slot=scroll-area-viewport]:max-h-[calc(90dvh-9rem)]">
                <div className="space-y-6 p-5">
                    <SwitchList>
                        <SwitchRow title="Report it" description={`${area.label} · ${event.description}`} checked={values.enabled} onCheckedChange={(checked) => set("enabled", checked)} />
                    </SwitchList>

                    <div className="space-y-2">
                        <p className="text-sm font-medium">Send it to</p>
                        <ChoiceCards
                            value={values.own ? "own" : "default"}
                            onValueChange={(mode) => set("own", mode === "own")}
                            aria-label="Send it to"
                            options={[
                                { value: "default", title: "The default channels", description: `${defaultNames}, and what the default channels get later.` },
                                { value: "own", title: "Its own channels", description: "Only the channels ticked below." },
                            ]}
                        />
                        {values.own &&
                            (channels.length === 0 ? (
                                <p className="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">There is no notification channel yet.</p>
                            ) : (
                                <ChannelChecklist channels={channels} value={values.channels} onChange={(ids) => set("channels", ids)} />
                            ))}
                        {problem && <p className="text-xs text-destructive">{problem}</p>}
                    </div>

                    {event.notifyUser !== null && (
                        <div className="space-y-2">
                            <p className="text-sm font-medium">Tell the user too</p>
                            <ChoiceCards
                                value={values.notifyUser}
                                onValueChange={(mode) => set("notifyUser", mode as NotifyUserMode)}
                                aria-label="Tell the user too"
                                className="sm:grid-cols-3"
                                options={[
                                    { value: "none", title: "Only the channels", description: "The user hears nothing." },
                                    { value: "also", title: "The channels and the user", description: "The user gets an email about it too." },
                                    { value: "only", title: "Only the user", description: "Nobody else hears about it." },
                                ]}
                            />
                            <p className="text-xs text-muted-foreground">The email to the user goes out through the email channels among the channels of the event.</p>
                        </div>
                    )}

                    {event.supportsReminder && (
                        <div className="space-y-2">
                            <Label htmlFor={`reminder-${event.id}`}>Remind while it lasts</Label>
                            <Select value={values.reminder} onValueChange={(reminder) => set("reminder", reminder)}>
                                <SelectTrigger id={`reminder-${event.id}`} className="w-full sm:w-64">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="default">{event.defaultReminderHours ? `The default, ${everyText(event.defaultReminderHours)}` : "The default"}</SelectItem>
                                    <SelectItem value="0">Off, it sends once</SelectItem>
                                    {reminderChoices.map((hours) => (
                                        <SelectItem key={hours} value={String(hours)}>
                                            {everyText(hours)[0].toUpperCase() + everyText(hours).slice(1)}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground">It sends once more after this time while it lasts, and stops once it is over.</p>
                        </div>
                    )}
                </div>
            </ScrollArea>

            <div className={cn(DIALOG_FOOTER, "flex flex-wrap items-center gap-2")}>
                <Button type="button" variant="outline" onClick={() => onTest(event)} disabled={saving || dirty} title={dirty ? "Save first" : undefined}>
                    <Send />
                    Send a test
                </Button>
                <div className="ml-auto flex gap-2">
                    <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
                        Cancel
                    </Button>
                    <Button type="submit" disabled={saving}>
                        {saving && <Loader2 className="animate-spin" />}
                        Save changes
                    </Button>
                </div>
            </div>
        </form>
    );
}
