"use client";

import { useState } from "react";
import { useFormContext } from "react-hook-form";
import { Bell, BellOff, Pencil, Send, Sparkles, TriangleAlert, X } from "lucide-react";
import { AdapterIcon } from "@/components/adapter/adapter-icon";
import { useCan } from "@/components/permissions/permissions-context";
import { NotificationTemplateDialog, type TemplateStart } from "@/components/settings/templates/notification-template-dialog";
import { listenersOf, parseOutcomes, type NotificationTemplateItem } from "@/components/templates/notification-model";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { PERMISSIONS } from "@/lib/auth/permissions";
import type { AdapterOption, JobFormValues } from "./job-form-schema";
import { NotificationOverview, OutcomeChips } from "./notification-overview";
import { TemplateField, jobCount, typeOf } from "./notification-template-field";
import { useNotificationTemplates } from "./use-notification-templates";

const EVENTS: { value: string; label: string }[] = [
    { value: "SUCCESS|PARTIAL|FAILED", label: "After every run" },
    { value: "PARTIAL|FAILED", label: "When a run fails or is partial" },
    { value: "SUCCESS", label: "When a run succeeds" },
];

const TILE = "flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground";


/** A name like "Shop nightly notifications", or "Shop nightly notifications 2" when that one is taken. */
function freeName(base: string, taken: string[]): string {
    let name = base;
    for (let number = 2; taken.includes(name); number++) name = `${base} ${number}`;
    return name;
}

interface TemplateRowProps {
    template: NotificationTemplateItem;
    /** How many other jobs use it, which a change reaches too. */
    others: number;
    onEdit?: () => void;
    onRemove: () => void;
}

/** A template on the job with its channels, each with the runs it hears about. */
function TemplateRow({ template, others, onEdit, onRemove }: TemplateRowProps) {
    const count = template.channels.length;
    const meta = [template.description, count === 1 ? "1 channel" : `${count} channels`, others === 0 ? "No other job uses it" : `Also used by ${jobCount(others)}`].filter(Boolean).join(" · ");
    return (
        <div className="rounded-lg border p-3">
            <div className="flex items-center gap-3">
                <span className={TILE} aria-hidden="true">
                    <Bell className="size-3.5" />
                </span>
                <span className="grid min-w-0 flex-1 gap-0.5">
                    <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-sm font-medium">{template.name}</span>
                        {template.isDefault && <Badge variant="secondary">Default</Badge>}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">{meta}</span>
                </span>
                {onEdit && (
                    <Button type="button" variant="outline" size="sm" onClick={onEdit} aria-label={`Edit ${template.name}`}>
                        <Pencil />
                        Edit
                    </Button>
                )}
                <Button type="button" variant="ghost" className="size-8 shrink-0 p-0 text-muted-foreground hover:text-destructive" onClick={onRemove} aria-label={`Remove ${template.name}`}>
                    <X />
                </Button>
            </div>
            <ul className="mt-2.5 space-y-1.5 border-t pt-2.5 sm:ml-11">
                {template.channels.map((channel) => (
                    <li key={channel.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                        <AdapterIcon adapterId={channel.config.adapterId} className="size-4 shrink-0" />
                        <span className="min-w-0 truncate">{channel.config.name}</span>
                        <span className="text-xs text-muted-foreground">{typeOf(channel.config.adapterId)}</span>
                        <span className="ml-auto">
                            <OutcomeChips outcomes={parseOutcomes(channel.events)} />
                        </span>
                    </li>
                ))}
            </ul>
        </div>
    );
}

/**
 * Who hears about a run: the notification templates of the job as rows with their channels, a field
 * that adds one, and a table of every channel over all of them. The channels an older job names
 * directly show on their own, with a way to turn them into a template.
 */
export function NotificationsPart({ channels }: { channels: AdapterOption[] }) {
    const form = useFormContext<JobFormValues>();
    const { templates, loading, failed, saved } = useNotificationTemplates();
    const canWrite = useCan(PERMISSIONS.TEMPLATES.WRITE);
    const [dialog, setDialog] = useState<{ open: boolean; template?: NotificationTemplateItem; start?: TemplateStart }>({ open: false });
    const pickedIds = form.watch("notificationTemplateIds");
    const directIds = form.watch("notificationIds");
    const events = form.watch("notificationEvents");
    // The job counts in the jobs of a template it was saved with, so the rows count the others.
    const savedIds = form.formState.defaultValues?.notificationTemplateIds ?? [];

    const picked = pickedIds.flatMap((id) => templates.filter((template) => template.id === id));
    const direct = directIds.map((id) => channels.find((channel) => channel.id === id) ?? { id, name: "Unknown channel", adapterId: "" });
    const listeners = listenersOf(picked, direct, events);

    const setPicked = (ids: string[]) => form.setValue("notificationTemplateIds", ids, { shouldDirty: true });
    const setDirect = (ids: string[]) => form.setValue("notificationIds", ids, { shouldDirty: true });
    const edit = canWrite ? (template: NotificationTemplateItem) => setDialog({ open: true, template }) : undefined;

    const onSaved = (template: NotificationTemplateItem) => {
        saved(template);
        if (!dialog.template) {
            setPicked([...pickedIds.filter((id) => id !== template.id), template.id]);
            // A template made from the channels the job names directly takes their place.
            if (dialog.start) setDirect([]);
        }
        // The template stays until the dialog has faded out, so its head does not turn into New on the way.
        setDialog((current) => ({ ...current, open: false }));
    };

    const makeTemplate = () =>
        setDialog({
            open: true,
            start: {
                name: freeName(`${form.getValues("name").trim() || "Job"} notifications`, templates.map((template) => template.name)),
                channels: directIds.map((configId) => ({ configId, events: events.join("|") })),
            },
        });

    return (
        <>
            <div className="space-y-2.5">
                {loading ? (
                    pickedIds.map((id) => <Skeleton key={id} className="h-24 rounded-lg" />)
                ) : failed ? (
                    <p className="text-sm text-muted-foreground">The templates of the job could not be loaded.</p>
                ) : picked.length === 0 && direct.length === 0 ? (
                    <div className="grid justify-items-center gap-2 rounded-lg border border-dashed px-5 py-6 text-center">
                        <span className={TILE} aria-hidden="true">
                            <BellOff className="size-3.5" />
                        </span>
                        <p className="text-sm font-medium">Nobody hears about this job</p>
                        <p className="max-w-sm text-xs text-muted-foreground">
                            A template names channels and after which runs each one gets a message. Without one a failed run goes unnoticed.
                        </p>
                    </div>
                ) : (
                    picked.map((template) => (
                        <TemplateRow
                            key={template.id}
                            template={template}
                            others={Math.max(0, (template._count?.jobs ?? 0) - (savedIds.includes(template.id) ? 1 : 0))}
                            onEdit={edit && !template.isSystem ? () => edit(template) : undefined}
                            onRemove={() => setPicked(pickedIds.filter((id) => id !== template.id))}
                        />
                    ))
                )}
                <TemplateField
                    templates={templates}
                    loading={loading}
                    picked={pickedIds}
                    onPick={(id) => setPicked([...pickedIds, id])}
                    onEdit={edit}
                    onCreate={canWrite ? () => setDialog({ open: true }) : undefined}
                />
            </div>

            {direct.length > 0 && picked.length > 0 && (
                <div role="status" className="flex flex-wrap items-center gap-x-2.5 gap-y-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
                    <TriangleAlert className="size-4 shrink-0 text-warning" aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                        {direct.map((channel) => channel.name).join(", ")} {direct.length === 1 ? "is" : "are"} also named directly. The templates replace them, so they
                        never get a message.
                    </span>
                    <Button type="button" variant="outline" size="sm" className="h-7 border-warning/50 bg-card text-xs hover:bg-warning/15" onClick={() => setDirect([])}>
                        Remove them
                    </Button>
                </div>
            )}

            {direct.length > 0 && picked.length === 0 && (
                <div className="rounded-lg border p-3">
                    <div className="flex items-center gap-3">
                        <span className={TILE} aria-hidden="true">
                            <Send className="size-3.5" />
                        </span>
                        <span className="grid min-w-0 flex-1 gap-0.5">
                            <span className="text-sm font-medium">Channels named directly</span>
                            <span className="truncate text-xs text-muted-foreground">From the Quick Setup or an older version, without a template</span>
                        </span>
                    </div>
                    <ul className="mt-2.5 space-y-1 border-t pt-2 sm:ml-11">
                        {direct.map((channel) => (
                            <li key={channel.id} className="flex items-center gap-2 text-sm">
                                {channel.adapterId && <AdapterIcon adapterId={channel.adapterId} className="size-4 shrink-0" />}
                                <span className="min-w-0 truncate">{channel.name}</span>
                                <span className="text-xs text-muted-foreground">{typeOf(channel.adapterId)}</span>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    className="ml-auto size-7 shrink-0 p-0 text-muted-foreground hover:text-destructive"
                                    onClick={() => setDirect(directIds.filter((id) => id !== channel.id))}
                                    aria-label={`Remove ${channel.name}`}
                                >
                                    <X />
                                </Button>
                            </li>
                        ))}
                    </ul>
                    <div className="mt-2.5 flex flex-wrap items-center gap-2 sm:ml-11">
                        <Select
                            value={EVENTS.some((option) => option.value === events.join("|")) ? events.join("|") : EVENTS[0].value}
                            onValueChange={(value) => form.setValue("notificationEvents", value.split("|") as JobFormValues["notificationEvents"], { shouldDirty: true })}
                        >
                            <SelectTrigger size="sm" className="w-auto" aria-label="When they are told">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {EVENTS.map((option) => (
                                    <SelectItem key={option.value} value={option.value}>
                                        {option.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        {canWrite && (
                            <Button type="button" variant="outline" size="sm" onClick={makeTemplate}>
                                <Sparkles />
                                Make a template of them
                            </Button>
                        )}
                    </div>
                </div>
            )}

            {listeners.length > 0 && <NotificationOverview listeners={listeners} />}

            <NotificationTemplateDialog
                open={dialog.open}
                onOpenChange={(next) => setDialog((current) => ({ ...current, open: next }))}
                template={dialog.template}
                start={dialog.start}
                channels={channels}
                onSuccess={onSaved}
            />
        </>
    );
}
