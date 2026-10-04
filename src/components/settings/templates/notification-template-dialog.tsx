"use client";

import { useContext, useId, useState } from "react";
import { Bell, Loader2, Pencil, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { createNotificationTemplate, updateNotificationTemplate } from "@/app/actions/templates";
import { ConnectionAddedContext, ConnectionPicker } from "@/components/dashboard/jobs/connection-picker";
import type { AdapterOption } from "@/components/dashboard/jobs/job-form-schema";
import { Pill } from "@/components/dashboard/jobs/schedule-fields";
import { OUTCOME_DOTS, OUTCOME_LABELS, OUTCOMES, parseOutcomes, type NotificationTemplateItem, type Outcome } from "@/components/templates/notification-model";
import { Button } from "@/components/ui/button";
import { DIALOG_FOOTER, DIALOG_SURFACE, DialogHead, dialogNoteClass } from "@/components/ui/confirm-dialog";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { cn } from "@/lib/utils";
import type { TemplateChannelConnection } from "@/services/templates/notification-template-service";

const log = logger.child({ component: "NotificationTemplateDialog" });

/** Leaves room for the head and the foot on a short screen. */
const BODY_SCROLL = "min-h-0 flex-1 *:data-[slot=scroll-area-viewport]:max-h-[calc(95dvh-9.5rem)] [&>[data-slot=scroll-area-viewport]>div]:block!";

/** One row of the list: a channel, empty until one is picked, and after which runs it hears. */
interface Draft {
    key: number;
    configId: string;
    outcomes: Outcome[];
}

/** Keeps every row its own key while rows come and go. */
let draftKeys = 0;
const draftOf = (configId: string, events: string): Draft => ({ key: draftKeys++, configId, outcomes: parseOutcomes(events) });

/** What a new template starts with, like the channels a job named directly. */
export interface TemplateStart {
    name: string;
    channels: { configId: string; events: string }[];
}

interface TemplateFormProps {
    template?: NotificationTemplateItem;
    channels: TemplateChannelConnection[];
    start?: TemplateStart;
    onSuccess: (template: NotificationTemplateItem) => void;
}

function OutcomePills({ value, onChange, label }: { value: Outcome[]; onChange: (outcomes: Outcome[]) => void; label: string }) {
    return (
        <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs text-muted-foreground">Hears about</span>
            {OUTCOMES.map((outcome) => (
                <Pill
                    key={outcome}
                    picked={value.includes(outcome)}
                    onClick={() => onChange(value.includes(outcome) ? value.filter((entry) => entry !== outcome) : OUTCOMES.filter((entry) => entry === outcome || value.includes(entry)))}
                >
                    <span className={cn("mr-1.5 size-1.5 rounded-full", OUTCOME_DOTS[outcome])} aria-hidden="true" />
                    {OUTCOME_LABELS[outcome]}
                </Pill>
            ))}
        </div>
    );
}

/** The content of the dialog, mounted on every open, so it always starts from the saved template. */
function TemplateForm({ template, channels, start, onSuccess }: TemplateFormProps) {
    const [name, setName] = useState(template?.name ?? start?.name ?? "");
    const [description, setDescription] = useState(template?.description ?? "");
    const [drafts, setDrafts] = useState<Draft[]>(() => {
        const saved = template?.channels ?? start?.channels ?? [];
        return saved.length > 0 ? saved.map((channel) => draftOf(channel.configId, channel.events)) : [draftOf("", OUTCOMES.join("|"))];
    });
    const [problem, setProblem] = useState<{ field: "name" | "channels"; text: string } | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    // A channel added from a row shows in every row, and in the form the dialog was opened from.
    const [added, setAdded] = useState<AdapterOption[]>([]);
    const report = useContext(ConnectionAddedContext);
    const options: AdapterOption[] = [...channels, ...added.filter((option) => !channels.some((known) => known.id === option.id))];
    const nameId = useId();
    const tone = template ? "edit" : "create";

    const change = (key: number, patch: Partial<Draft>) => {
        setDrafts((list) => list.map((draft) => (draft.key === key ? { ...draft, ...patch } : draft)));
        setProblem(null);
    };

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        const trimmed = name.trim();
        if (!trimmed) return setProblem({ field: "name", text: "Give the template a name." });
        if (!drafts.some((draft) => draft.configId)) return setProblem({ field: "channels", text: "Add at least one channel." });
        if (drafts.some((draft) => !draft.configId)) return setProblem({ field: "channels", text: "Pick a channel in every row, or remove the row." });
        if (drafts.some((draft) => draft.outcomes.length === 0)) return setProblem({ field: "channels", text: "Pick at least one run for every channel." });

        setIsSaving(true);
        const input = {
            name: trimmed,
            // An emptied description is saved empty, so it can be cleared.
            description: description.trim(),
            channels: drafts.map((draft) => ({ configId: draft.configId, events: draft.outcomes.join("|") })),
        };
        try {
            const res = template ? await updateNotificationTemplate(template.id, input) : await createNotificationTemplate(input);
            if (res.success && res.data) {
                toast.success(template ? "Notification template updated" : "Notification template created");
                onSuccess(res.data);
                return;
            }
            toast.error(res.error || "The template could not be saved.");
        } catch (error: unknown) {
            // Without the right to write templates the action throws instead of answering.
            log.warn("Notification template could not be saved", {}, wrapError(error));
            toast.error("The template could not be saved.");
        }
        setIsSaving(false);
    };

    return (
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
            <DialogHead tone={tone} icon={template ? Pencil : Bell} className="px-5 py-4">
                <DialogTitle className="text-base">{template ? "Edit notification template" : "New notification template"}</DialogTitle>
                <DialogDescription className={cn(dialogNoteClass(tone), "truncate")}>
                    {template ? `${template.name} · A change applies to every job that uses it` : "Which channels hear about a run, and after which runs"}
                </DialogDescription>
            </DialogHead>

            <ConnectionAddedContext.Provider
                value={(option) => {
                    setAdded((list) => [...list, option]);
                    report?.(option);
                }}
            >
                <ScrollArea className={BODY_SCROLL}>
                    <div className="space-y-5 p-5">
                        <div className="space-y-2">
                            <Label htmlFor={nameId}>Name</Label>
                            <Input
                                id={nameId}
                                value={name}
                                onChange={(event) => {
                                    setName(event.target.value);
                                    setProblem(null);
                                }}
                                placeholder="e.g. Ops alerts"
                                autoComplete="off"
                                aria-invalid={problem?.field === "name" || undefined}
                                aria-describedby={problem?.field === "name" ? `${nameId}-message` : undefined}
                            />
                            {problem?.field === "name" && (
                                <p id={`${nameId}-message`} className="text-sm text-destructive">
                                    {problem.text}
                                </p>
                            )}
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor={`${nameId}-description`}>Description</Label>
                            <Input
                                id={`${nameId}-description`}
                                value={description}
                                onChange={(event) => setDescription(event.target.value)}
                                placeholder="Optional, like who it is meant for"
                                autoComplete="off"
                            />
                        </div>

                        <div className="space-y-2.5">
                            <div className="flex items-baseline justify-between gap-3">
                                <p className="text-sm font-medium">Channels</p>
                                <span className="text-xs text-muted-foreground">Each one hears about the runs picked for it</span>
                            </div>
                            {drafts.map((draft, index) => (
                                <div key={draft.key} className="space-y-2.5 rounded-lg border p-3">
                                    <div className="flex items-center gap-2">
                                        <ConnectionPicker
                                            kind="notification"
                                            options={options}
                                            value={draft.configId}
                                            onChange={(configId) => change(draft.key, { configId })}
                                            taken={drafts.filter((other) => other.key !== draft.key).map((other) => other.configId).filter(Boolean)}
                                            placeholder="Pick a channel"
                                            aria-label={`Channel ${index + 1}`}
                                            className="flex-1"
                                        />
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            className="size-9 shrink-0 p-0 text-muted-foreground hover:text-destructive"
                                            onClick={() => {
                                                setDrafts((list) => list.filter((other) => other.key !== draft.key));
                                                setProblem(null);
                                            }}
                                            aria-label={`Remove channel ${index + 1}`}
                                        >
                                            <X />
                                        </Button>
                                    </div>
                                    <OutcomePills value={draft.outcomes} onChange={(outcomes) => change(draft.key, { outcomes })} label={`Runs channel ${index + 1} hears about`} />
                                </div>
                            ))}
                            {problem?.field === "channels" && <p className="text-sm text-destructive">{problem.text}</p>}
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                    setDrafts((list) => [...list, draftOf("", OUTCOMES.join("|"))]);
                                    setProblem(null);
                                }}
                            >
                                <Plus />
                                Add channel
                            </Button>
                        </div>
                    </div>
                </ScrollArea>
            </ConnectionAddedContext.Provider>

            <div className={cn(DIALOG_FOOTER, "flex items-center justify-end gap-2")}>
                <DialogClose asChild>
                    <Button type="button" variant="ghost">Cancel</Button>
                </DialogClose>
                <Button type="submit" disabled={isSaving}>
                    {isSaving && <Loader2 className="animate-spin" />}
                    {template ? "Save changes" : "Create template"}
                </Button>
            </div>
        </form>
    );
}

interface NotificationTemplateDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    template?: NotificationTemplateItem;
    /** The notification channels a template can send through. */
    channels: TemplateChannelConnection[];
    /** For a new template, what it starts with instead of one empty row. */
    start?: TemplateStart;
    onSuccess: (template: NotificationTemplateItem) => void;
}

/**
 * Adds a notification template or changes one: its channels, each with the runs it hears about. A
 * job that uses the template follows it, so a change reaches every one of them.
 */
export function NotificationTemplateDialog({ open, onOpenChange, template, channels, start, onSuccess }: NotificationTemplateDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent tone={template ? "edit" : "create"} showCloseButton={false} className={cn(DIALOG_SURFACE, "sm:max-w-xl")}>
                <TemplateForm template={template} channels={channels} start={start} onSuccess={onSuccess} />
            </DialogContent>
        </Dialog>
    );
}
