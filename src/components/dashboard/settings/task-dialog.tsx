"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Play } from "lucide-react";
import { toast } from "sonner";
import { saveSystemTaskAction } from "@/app/actions/settings/system-tasks";
import { ChoiceCards } from "@/components/adapter/connection-mode-choice";
import { SwitchList, SwitchRow } from "@/components/adapter/setting-switches";
import { SchedulePicker } from "@/components/dashboard/jobs/schedule-picker";
import { Button } from "@/components/ui/button";
import { DIALOG_FOOTER, DIALOG_SURFACE, DialogHead, dialogNoteClass } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { cn } from "@/lib/utils";
import type { IntegritySettings, SystemTaskRow } from "@/services/system/settings-types";
import { partOf } from "./settings-parts";
import { taskIcon } from "./task-columns";
import { withSaved } from "./settings-values";

const log = logger.child({ component: "task-dialog" });

const INTEGRITY_TASK = "system.integrity_check";
const AGE_CHOICES = [0, 7, 14, 30, 90, 180, 365] as const;
const SIZE_CHOICES = [0, 100, 500, 1024, 5120, 10240, 51200] as const;

/** "No limit", "30 days", "1 year". */
export function ageText(days: number): string {
    if (days === 0) return "No limit";
    if (days % 365 === 0) return days === 365 ? "1 year" : `${days / 365} years`;
    return days === 1 ? "1 day" : `${days} days`;
}

/** "No limit", "500 MB", "5 GB". */
export function sizeText(megabytes: number): string {
    if (megabytes === 0) return "No limit";
    return megabytes % 1024 === 0 ? `${megabytes / 1024} GB` : `${megabytes} MB`;
}

interface TaskValues {
    enabled: boolean;
    runOnStartup: boolean;
    schedule: string;
    integrity: IntegritySettings;
}

interface TaskDialogProps {
    task: SystemTaskRow | null;
    integrity: IntegritySettings;
    onOpenChange: (open: boolean) => void;
    /** Starts the task, for Run now in the foot. */
    onRun: (task: SystemTaskRow) => void;
}

/** Edit of a system task: on or off, at start, its schedule with the picker of the jobs, and what the integrity check looks at. */
export function TaskDialog({ task, integrity, onOpenChange, onRun }: TaskDialogProps) {
    const [saving, setSaving] = useState(false);
    return (
        <Dialog open={task !== null} onOpenChange={(open) => !saving && onOpenChange(open)}>
            <DialogContent tone="edit" showCloseButton={false} className={cn(DIALOG_SURFACE, "sm:max-w-2xl")}>
                {task && <TaskForm key={task.id} task={task} integrity={integrity} saving={saving} onSavingChange={setSaving} onClose={() => onOpenChange(false)} onRun={onRun} />}
            </DialogContent>
        </Dialog>
    );
}

interface TaskFormProps {
    task: SystemTaskRow;
    integrity: IntegritySettings;
    saving: boolean;
    onSavingChange: (saving: boolean) => void;
    onClose: () => void;
    onRun: (task: SystemTaskRow) => void;
}

function TaskForm({ task, integrity, saving, onSavingChange, onClose, onRun }: TaskFormProps) {
    const router = useRouter();
    const [initial] = useState<TaskValues>(() => ({ enabled: task.enabled, runOnStartup: task.runOnStartup, schedule: task.schedule, integrity }));
    const [values, setValues] = useState<TaskValues>(initial);
    const [problem, setProblem] = useState<{ field?: string; message: string } | null>(null);
    const isIntegrity = task.id === INTEGRITY_TASK;
    const dirty = JSON.stringify(values) !== JSON.stringify(initial);
    const followed = task.follows ? partOf(task.follows.part).label : null;

    const set = <K extends keyof TaskValues>(key: K, value: TaskValues[K]) => {
        setValues((current) => ({ ...current, [key]: value }));
        setProblem(null);
    };
    const setIntegrity = <K extends keyof IntegritySettings>(key: K, value: IntegritySettings[K]) => set("integrity", { ...values.integrity, [key]: value });

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!dirty) return onClose();
        onSavingChange(true);
        try {
            const result = await saveSystemTaskAction(task.id, {
                enabled: values.enabled,
                runOnStartup: values.runOnStartup,
                schedule: values.schedule,
                ...(isIntegrity ? { integrity: values.integrity } : {}),
            });
            if (!result.success) {
                setProblem({ field: result.field, message: result.error });
                toast.error(result.error);
                return;
            }
            toast.success(`${task.name} saved`);
            router.refresh();
            onClose();
        } catch (error: unknown) {
            log.warn("Saving a system task failed", { taskId: task.id }, wrapError(error));
            toast.error("The task could not be saved.");
        } finally {
            onSavingChange(false);
        }
    };

    const errorOf = (field: string) => (problem?.field === field ? problem.message : null);

    return (
        <form onSubmit={(event) => void submit(event)} noValidate className="flex min-h-0 flex-1 flex-col">
            <DialogHead tone="edit" icon={taskIcon(task.id)}>
                <DialogTitle className="truncate text-base">Edit {task.name}</DialogTitle>
                <DialogDescription className={dialogNoteClass("edit")}>A change applies to the next run</DialogDescription>
            </DialogHead>

            <ScrollArea className="min-h-0 flex-1 *:data-[slot=scroll-area-viewport]:max-h-[calc(90dvh-9rem)]">
                <div className="space-y-6 p-5">
                    <p className="text-sm text-muted-foreground">{task.description}</p>

                    <div className="space-y-2">
                        <SwitchList>
                            <SwitchRow
                                title="Run on the schedule"
                                description={followed ? `The same switch as ${task.follows?.setting} under ${followed}.` : values.enabled ? "It runs on the schedule below." : "Off, it only runs with Run now."}
                                checked={values.enabled}
                                onCheckedChange={(checked) => set("enabled", checked)}
                            />
                            <SwitchRow
                                title="Run when DBackup starts"
                                description="Ten seconds after a start, while it runs on its schedule."
                                checked={values.runOnStartup}
                                onCheckedChange={(checked) => set("runOnStartup", checked)}
                            />
                        </SwitchList>
                        {errorOf("enabled") && <p className="text-xs text-destructive">{errorOf("enabled")}</p>}
                    </div>

                    <div className="space-y-2">
                        <p className="text-sm font-medium">Schedule</p>
                        <SchedulePicker value={values.schedule} onChange={(schedule) => set("schedule", schedule)} withClashes={false} />
                        {errorOf("schedule") && <p className="text-xs text-destructive">{errorOf("schedule")}</p>}
                    </div>

                    {isIntegrity && (
                        <div className="space-y-4">
                            <div className="space-y-2">
                                <p className="text-sm font-medium">What it checks</p>
                                <ChoiceCards
                                    value={values.integrity.scanMode}
                                    onValueChange={(mode) => setIntegrity("scanMode", mode === "destinations" ? "destinations" : "jobs")}
                                    options={[
                                        { value: "jobs", title: "Backups of jobs", description: "Only files that belong to a job, and it skips what a job or a destination skips." },
                                        { value: "destinations", title: "Every file", description: "Every file of every destination, and it skips what a destination skips." },
                                    ]}
                                    aria-label="What it checks"
                                />
                            </div>
                            <SwitchList>
                                <SwitchRow
                                    title="Skip backups that passed"
                                    description="Checks only backups never checked or failed before."
                                    checked={values.integrity.skipPassed}
                                    onCheckedChange={(checked) => setIntegrity("skipPassed", checked)}
                                />
                            </SwitchList>
                            <div className="grid gap-4 sm:grid-cols-2">
                                <div className="space-y-2">
                                    <Label htmlFor="integrity-age">Only backups newer than</Label>
                                    <Select value={String(values.integrity.maxAgeDays)} onValueChange={(days) => setIntegrity("maxAgeDays", Number(days))}>
                                        <SelectTrigger id="integrity-age" className="w-full">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {withSaved(AGE_CHOICES, values.integrity.maxAgeDays).map((days) => (
                                                <SelectItem key={days} value={String(days)}>{ageText(days)}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <p className="text-xs text-muted-foreground">Older ones count as skipped.</p>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="integrity-size">Skip files larger than</Label>
                                    <Select value={String(values.integrity.maxFileSizeMb)} onValueChange={(size) => setIntegrity("maxFileSizeMb", Number(size))}>
                                        <SelectTrigger id="integrity-size" className="w-full">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {withSaved(SIZE_CHOICES, values.integrity.maxFileSizeMb).map((size) => (
                                                <SelectItem key={size} value={String(size)}>{sizeText(size)}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <p className="text-xs text-muted-foreground">A destination without a checksum of its own downloads each file.</p>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </ScrollArea>

            <div className={cn(DIALOG_FOOTER, "flex flex-wrap items-center gap-2")}>
                <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                        onRun(task);
                        onClose();
                    }}
                    disabled={saving || dirty || task.running}
                    title={dirty ? "Save first" : undefined}
                >
                    <Play />
                    Run now
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
