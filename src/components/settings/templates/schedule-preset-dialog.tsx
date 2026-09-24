"use client";

import { useId, useState } from "react";
import { CalendarClock, Loader2, Pencil } from "lucide-react";
import type { SchedulePreset } from "@prisma/client";
import { toast } from "sonner";
import { createSchedulePreset, updateSchedulePreset } from "@/app/actions/templates";
import { SchedulePicker } from "@/components/dashboard/jobs/schedule-picker";
import { isValidCron } from "@/lib/core/cron";
import { Button } from "@/components/ui/button";
import { DIALOG_FOOTER, DIALOG_SURFACE, DialogHead, dialogNoteClass } from "@/components/ui/confirm-dialog";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

const DEFAULT_SCHEDULE = "0 3 * * *";
/** Leaves room for the head and the foot on a short screen. */
const BODY_SCROLL = "min-h-0 flex-1 *:data-[slot=scroll-area-viewport]:max-h-[calc(95dvh-9.5rem)] [&>[data-slot=scroll-area-viewport]>div]:block!";

interface PresetFormProps {
    preset?: SchedulePreset;
    /** The job the preset is made for, left out of the jobs its schedule could meet. */
    jobId?: string;
    onSuccess: (preset: SchedulePreset) => void;
}

/** The content of the dialog, mounted on every open, so it always starts from the saved preset. */
function PresetForm({ preset, jobId, onSuccess }: PresetFormProps) {
    const [name, setName] = useState(preset?.name ?? "");
    const [description, setDescription] = useState(preset?.description ?? "");
    const [schedule, setSchedule] = useState(preset?.schedule ?? DEFAULT_SCHEDULE);
    const [nameMissing, setNameMissing] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const nameId = useId();
    const descriptionId = useId();
    const tone = preset ? "edit" : "create";

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!name.trim()) {
            setNameMissing(true);
            return;
        }
        // The picker already says what is wrong with the schedule.
        if (!isValidCron(schedule)) return;
        setIsSaving(true);
        const input = { name: name.trim(), description, schedule };
        const res = preset ? await updateSchedulePreset(preset.id, input) : await createSchedulePreset(input);
        setIsSaving(false);
        if (res.success && res.data) {
            toast.success(preset ? "Schedule preset updated" : "Schedule preset created");
            onSuccess(res.data);
        } else {
            toast.error(res.error || "Failed to save schedule preset");
        }
    };

    return (
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
            <DialogHead tone={tone} icon={preset ? Pencil : CalendarClock} className="px-5 py-4">
                <DialogTitle className="text-base">{preset ? "Edit schedule preset" : "New schedule preset"}</DialogTitle>
                <DialogDescription className={cn(dialogNoteClass(tone), "truncate")}>
                    {preset ? `${preset.name} · A change applies to every job that follows it` : "A schedule that jobs can follow"}
                </DialogDescription>
            </DialogHead>

            <ScrollArea className={BODY_SCROLL}>
                <div className="space-y-5 p-5">
                    <div className="space-y-2">
                        <Label htmlFor={nameId}>Name</Label>
                        <Input
                            id={nameId}
                            value={name}
                            onChange={(event) => {
                                setName(event.target.value);
                                setNameMissing(false);
                            }}
                            placeholder="e.g. Daily at 3 AM"
                            autoComplete="off"
                            aria-invalid={nameMissing || undefined}
                            aria-describedby={nameMissing ? `${nameId}-message` : undefined}
                        />
                        {nameMissing && (
                            <p id={`${nameId}-message`} className="text-sm text-destructive">
                                Give the preset a name.
                            </p>
                        )}
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor={descriptionId}>Description</Label>
                        <Input
                            id={descriptionId}
                            value={description}
                            onChange={(event) => setDescription(event.target.value)}
                            placeholder="Optional, like which jobs it is meant for"
                            autoComplete="off"
                        />
                    </div>
                    <div className="space-y-2">
                        <Label>Schedule</Label>
                        <SchedulePicker value={schedule} onChange={setSchedule} presetId={preset?.id} jobId={jobId} />
                    </div>
                </div>
            </ScrollArea>

            <div className={cn(DIALOG_FOOTER, "flex items-center justify-end gap-2")}>
                <DialogClose asChild>
                    <Button type="button" variant="ghost">Cancel</Button>
                </DialogClose>
                <Button type="submit" disabled={isSaving}>
                    {isSaving && <Loader2 className="animate-spin" />}
                    {preset ? "Save changes" : "Create preset"}
                </Button>
            </div>
        </form>
    );
}

interface SchedulePresetDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    preset?: SchedulePreset;
    /** The job the dialog was opened for, from the job form. */
    jobId?: string;
    onSuccess: (preset: SchedulePreset) => void;
}

/**
 * Adds a schedule preset or changes one. A job that follows a preset runs on its schedule, so a
 * change reaches every one of them at once.
 */
export function SchedulePresetDialog({ open, onOpenChange, preset, jobId, onSuccess }: SchedulePresetDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent tone={preset ? "edit" : "create"} showCloseButton={false} className={cn(DIALOG_SURFACE, "sm:max-w-xl")}>
                <PresetForm preset={preset} jobId={jobId} onSuccess={onSuccess} />
            </DialogContent>
        </Dialog>
    );
}
