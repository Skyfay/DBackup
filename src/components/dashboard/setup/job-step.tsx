"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Lock, LockOpen } from "lucide-react";
import { toast } from "sonner";
import { ChoiceCards, type ModeOption } from "@/components/adapter/connection-mode-choice";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDateFormatter } from "@/hooks/use-date-formatter";
import { DatabaseChecklist } from "@/components/adapter/database-checklist";
import { jobDefaults, jobSchema, type JobDraft, type JobValues } from "./job-values";
import {
    KEEP_COUNT, NOTIFY_ON, SCHEDULES, canPickDatabases, compressesItself, jobRequest, nextRun,
    type SetupJob, type SetupState, type SetupStep,
} from "./setup-model";
import { BackButton, StepFrame } from "./step-frame";

/** The schedule cards. Their times are when the scheduler fires, read in the time zone of the user. */
function useScheduleOptions(schedulerTimezone: string): ModeOption[] {
    const { formatDate } = useDateFormatter();
    const at = (schedule: string, format: string) => {
        const next = nextRun(schedule, schedulerTimezone);
        return next ? formatDate(next, format) : "";
    };
    return [
        { value: "hourly", title: "Every hour", description: "On the hour" },
        { value: "nightly", title: "Every night", description: `At ${at(SCHEDULES.nightly, "p")}` },
        { value: "weekly", title: "Every week", description: `${at(SCHEDULES.weekly, "EEEE")} at ${at(SCHEDULES.weekly, "p")}` },
        { value: "custom", title: "Custom", description: "A cron expression" },
    ];
}

const SCOPES: ModeOption[] = [
    { value: "all", title: "All databases", description: "Also the ones added later" },
    { value: "some", title: "Some databases", description: "Pick them from the server" },
];

interface JobStepProps {
    step: SetupStep;
    position: string;
    state: SetupState;
    draft: JobDraft | null;
    onDraftChange: (draft: JobDraft) => void;
    schedulerTimezone: string;
    onBack: () => void;
    onDone: (job: SetupJob) => void;
}

/** The job that ties the steps together: its name, when it runs and what goes in. */
export function JobStep({ step, position, state, draft, onDraftChange, schedulerTimezone, onBack, onDone }: JobStepProps) {
    const database = state.database;
    const form = useForm<JobValues>({ resolver: zodResolver(jobSchema), defaultValues: jobDefaults(database, draft) });
    const scheduleOptions = useScheduleOptions(schedulerTimezone);
    const sourceId = database?.id;
    const adapterId = database?.adapterId;
    const when = form.watch("when");
    const scope = form.watch("scope");
    const { isSubmitting } = form.formState;

    // Going back to an earlier step keeps what was typed here.
    useEffect(() => () => onDraftChange({ values: form.getValues(), source: database }), [form, onDraftChange, database]);

    const submit = form.handleSubmit(async (values) => {
        const schedule = values.when === "custom" ? values.cron.trim() : SCHEDULES[values.when];
        const request = jobRequest(state, {
            name: values.name,
            schedule,
            databases: values.scope === "some" ? values.databases : [],
            compression: values.compression,
            notifyOn: values.notifyOn,
        });
        try {
            const res = await fetch("/api/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) });
            const body = await res.json().catch(() => null);
            if (res.ok && typeof body?.id === "string") {
                toast.success("Backup job created");
                onDone({ id: body.id, name: request.name, schedule, notifyOn: values.notifyOn });
                return;
            }
            toast.error(body?.error || "The job could not be created.");
        } catch {
            toast.error("The job could not be created.");
        }
    });

    const LockIcon = state.encryption ? Lock : LockOpen;

    return (
        <Form {...form}>
            <StepFrame
                tone="create"
                icon={step.icon}
                title={step.title}
                note={`When it runs and what goes in · ${position}`}
                onSubmit={submit}
                start={<BackButton onClick={onBack} />}
                end={
                    <Button type="submit" disabled={isSubmitting}>
                        {isSubmitting && <Loader2 className="animate-spin" />}
                        Create backup job
                    </Button>
                }
            >
                <ScrollArea className="min-h-0 flex-1 [&>[data-slot=scroll-area-viewport]>div]:block!">
                    <div className="space-y-5 p-5">
                        <FormField
                            control={form.control}
                            name="name"
                            render={({ field }) => (
                                <FormItem>
                                    <div className="flex items-baseline justify-between gap-3">
                                        <FormLabel>Name</FormLabel>
                                        <span className="text-xs text-muted-foreground">Shown in the jobs list</span>
                                    </div>
                                    <FormControl>
                                        <Input autoComplete="off" {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name="when"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>When</FormLabel>
                                    <FormControl>
                                        <ChoiceCards value={field.value} onValueChange={field.onChange} options={scheduleOptions} aria-label="When" className="grid grid-cols-2 gap-2.5 xl:grid-cols-4" />
                                    </FormControl>
                                </FormItem>
                            )}
                        />
                        {when === "custom" && (
                            <FormField
                                control={form.control}
                                name="cron"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Cron expression</FormLabel>
                                        <FormControl>
                                            <Input placeholder="0 3 * * *" spellCheck={false} autoComplete="off" {...field} />
                                        </FormControl>
                                        <FormDescription>Minute, hour, day of the month, month and day of the week, in {schedulerTimezone}.</FormDescription>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        )}

                        {canPickDatabases(adapterId) && sourceId && (
                            <>
                                <FormField
                                    control={form.control}
                                    name="scope"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>What goes in</FormLabel>
                                            <FormControl>
                                                <ChoiceCards value={field.value} onValueChange={field.onChange} options={SCOPES} aria-label="What goes in" />
                                            </FormControl>
                                        </FormItem>
                                    )}
                                />
                                {scope === "some" && (
                                    <FormField
                                        control={form.control}
                                        name="databases"
                                        render={({ field }) => (
                                            <FormItem>
                                                <DatabaseChecklist sourceId={sourceId} value={field.value} onChange={field.onChange} />
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                )}
                            </>
                        )}

                        <div className="grid gap-4 sm:grid-cols-2">
                            {!compressesItself(adapterId) && (
                                <FormField
                                    control={form.control}
                                    name="compression"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Compression</FormLabel>
                                            <Select value={field.value} onValueChange={field.onChange}>
                                                <FormControl>
                                                    <SelectTrigger className="w-full">
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent>
                                                    <SelectItem value="NONE">None · fastest</SelectItem>
                                                    <SelectItem value="GZIP">Gzip · small and fast</SelectItem>
                                                    <SelectItem value="BROTLI">Brotli · smallest, slower</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </FormItem>
                                    )}
                                />
                            )}
                            {state.notification && (
                                <FormField
                                    control={form.control}
                                    name="notifyOn"
                                    render={({ field }) => (
                                        <FormItem className="min-w-0">
                                            <FormLabel className="block truncate">Tell {state.notification?.name}</FormLabel>
                                            <Select value={field.value} onValueChange={field.onChange}>
                                                <FormControl>
                                                    <SelectTrigger className="w-full">
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent>
                                                    <SelectItem value={NOTIFY_ON.failures}>When a run fails</SelectItem>
                                                    <SelectItem value={NOTIFY_ON.always}>After every run</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </FormItem>
                                    )}
                                />
                            )}
                        </div>

                        <p className="flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-xs text-muted-foreground">
                            <LockIcon className="size-3.5 shrink-0" aria-hidden="true" />
                            <span>
                                {state.encryption ? (
                                    <>
                                        Encrypted with <span className="font-medium text-foreground">{state.encryption.name}</span>
                                    </>
                                ) : (
                                    "Not encrypted"
                                )}
                                {` · keeps the last ${KEEP_COUNT} backups`}
                                {compressesItself(adapterId) && " · PostgreSQL compresses its own dump"}
                            </span>
                        </p>
                    </div>
                </ScrollArea>
            </StepFrame>
        </Form>
    );
}
