"use client";

import { useMemo, useState } from "react";
import { CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { isValidCron, nextRunTimes } from "@/lib/core/cron";
import { DEFAULT_RUN_MS, findScheduleClash, type ScheduleOwners } from "@/lib/core/schedule-conflicts";
import { describeSchedule } from "./job-schedule";
import { PickerRow, Pill, QuickPick, TimeList } from "./schedule-fields";
import {
    DEFAULT_SCHEDULE,
    HOUR_STEPS,
    MINUTE_STEPS,
    WEEK,
    WEEKDAYS,
    WEEKEND,
    buildCron,
    parseCron,
    suggestFreeTime,
    type ScheduleMode,
    type SimpleSchedule,
} from "./schedule-model";
import { ClashNote, ScheduleSummary } from "./schedule-summary";
import { useScheduleLoad } from "./use-schedule-load";
import { useSchedulerTimezone } from "./use-scheduler-timezone";

const MODES: { value: ScheduleMode; label: string }[] = [
    { value: "hourly", label: "Hourly" },
    { value: "daily", label: "Daily" },
    { value: "weekly", label: "Weekly" },
    { value: "monthly", label: "Monthly" },
    { value: "cron", label: "Cron" },
];
const DAYS_OF_MONTH = Array.from({ length: 31 }, (_, index) => index + 1);
const sameDays = (days: number[], set: number[]) => days.length === set.length && set.every((day) => days.includes(day));

interface SchedulePickerProps {
    value: string;
    onChange: (cron: string) => void;
    /** The job being edited. It is left out of the jobs this schedule could meet. */
    jobId?: string;
    /** The preset being edited. The jobs that follow it start together on this schedule. */
    presetId?: string;
}

/**
 * When a job or a preset runs: hourly, daily, weekly or monthly without cron, or cron itself.
 * Below it the schedule in words with its next runs, and a small warning when runs would wait
 * for a free slot of the queue, with a time that has room.
 */
export function SchedulePicker({ value, onChange, jobId, presetId }: SchedulePickerProps) {
    const [schedule, setSchedule] = useState<SimpleSchedule>(() => parseCron(value) ?? DEFAULT_SCHEDULE);
    const [mode, setMode] = useState<ScheduleMode>(() => parseCron(value)?.frequency ?? "cron");
    const [cronText, setCronText] = useState(value);
    const timezone = useSchedulerTimezone();
    const load = useScheduleLoad();

    const expression = mode === "cron" ? cronText.trim() : buildCron(schedule);
    const valid = isValidCron(expression);

    const update = (next: SimpleSchedule) => {
        setSchedule(next);
        onChange(buildCron(next));
    };

    const changeMode = (next: ScheduleMode) => {
        if (next === "cron") {
            setCronText(expression);
        } else {
            // Back from cron, the expression is taken over where the picker can show it.
            const base = mode === "cron" ? (parseCron(cronText) ?? schedule) : schedule;
            update({ ...base, frequency: next });
        }
        setMode(next);
    };

    const owners = useMemo<ScheduleOwners>(() => {
        const ids = new Set<string>(jobId ? [jobId] : []);
        for (const job of load?.jobs ?? []) if (presetId && job.presetId === presetId) ids.add(job.id);
        const durations = [...ids].map((id) => load?.jobs.find((job) => job.id === id)?.estimatedMs ?? DEFAULT_RUN_MS);
        return { ids: [...ids], durations: durations.length > 0 ? durations : [DEFAULT_RUN_MS] };
    }, [load, jobId, presetId]);

    const clash = useMemo(() => (load && valid ? findScheduleClash(expression, load, owners) : null), [load, valid, expression, owners]);
    const suggestion = useMemo(() => {
        // Moving the time only helps against other jobs, never against the jobs of the preset itself.
        if (!load || !clash || mode === "cron" || clash.others.length === 0) return null;
        return suggestFreeTime(schedule, (candidate) => findScheduleClash(candidate, load, owners) === null);
    }, [load, clash, mode, schedule, owners]);
    const nextRuns = useMemo(() => (timezone && valid ? nextRunTimes(expression, timezone, 3) : []), [timezone, valid, expression]);

    const described = valid ? describeSchedule(expression) : null;
    const words = described ? (described.described ? described.text : "Custom schedule") : null;
    const cronFields = cronText.trim().split(/\s+/).filter(Boolean).length;

    return (
        <div className="overflow-hidden rounded-lg border bg-card">
            <div className="px-3 pt-3 sm:px-4">
                {/* Manual, so arrowing through the kinds does not rewrite the schedule on every step. */}
                <Tabs value={mode} onValueChange={(next) => changeMode(next as ScheduleMode)} activationMode="manual">
                    <TabsList className="h-8 w-full sm:w-auto" aria-label="How often">
                        {MODES.map((option) => (
                            <TabsTrigger key={option.value} value={option.value} className="px-2 text-xs sm:px-2.5">
                                {option.label}
                            </TabsTrigger>
                        ))}
                    </TabsList>
                </Tabs>
            </div>

            <div className="grid gap-3 p-3 sm:p-4">
                {mode === "hourly" && (
                    <>
                        <PickerRow label="Every">
                            {HOUR_STEPS.map((step) => (
                                <Pill key={step} picked={schedule.everyHours === step} onClick={() => update({ ...schedule, everyHours: step })}>
                                    {step} h
                                </Pill>
                            ))}
                        </PickerRow>
                        <PickerRow label="At minute">
                            {[...new Set([...MINUTE_STEPS, schedule.minute])].sort((a, b) => a - b).map((minute) => (
                                <Pill key={minute} picked={schedule.minute === minute} onClick={() => update({ ...schedule, minute })}>
                                    :{String(minute).padStart(2, "0")}
                                </Pill>
                            ))}
                        </PickerRow>
                    </>
                )}

                {mode === "weekly" && (
                    <PickerRow
                        label="On"
                        aside={
                            <>
                                <QuickPick onClick={() => update({ ...schedule, days: WEEKDAYS })}>Weekdays</QuickPick>
                                <QuickPick onClick={() => update({ ...schedule, days: WEEKEND })}>Weekend</QuickPick>
                            </>
                        }
                    >
                        {WEEK.map((day) => {
                            const picked = schedule.days.includes(day.value);
                            return (
                                <Pill
                                    key={day.value}
                                    picked={picked}
                                    label={day.name}
                                    onClick={() => {
                                        const days = picked ? schedule.days.filter((value) => value !== day.value) : [...schedule.days, day.value];
                                        update({ ...schedule, days: days.sort((a, b) => a - b) });
                                    }}
                                >
                                    {day.short}
                                </Pill>
                            );
                        })}
                    </PickerRow>
                )}
                {mode === "weekly" && schedule.days.length === 0 && <p className="text-xs text-destructive">Pick at least one day.</p>}
                {mode === "weekly" && sameDays(schedule.days, [0, 1, 2, 3, 4, 5, 6]) && (
                    <p className="text-xs text-muted-foreground">Every day of the week, the same as Daily.</p>
                )}

                {mode === "monthly" && (
                    <PickerRow label="On day">
                        <Select
                            value={String(schedule.dayOfMonth)}
                            onValueChange={(day) => update({ ...schedule, dayOfMonth: day === "L" ? "L" : Number(day) })}
                        >
                            <SelectTrigger className="h-8 w-32" aria-label="Day of the month">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="L">Last day</SelectItem>
                                {DAYS_OF_MONTH.map((day) => (
                                    <SelectItem key={day} value={String(day)}>
                                        {day}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        {typeof schedule.dayOfMonth === "number" && schedule.dayOfMonth > 28 && (
                            <span className="text-xs text-muted-foreground">Months without it are left out.</span>
                        )}
                    </PickerRow>
                )}

                {(mode === "daily" || mode === "weekly" || mode === "monthly") && (
                    <PickerRow label="At">
                        <TimeList hours={schedule.hours} minute={schedule.minute} onChange={(hours, minute) => update({ ...schedule, hours, minute })} />
                    </PickerRow>
                )}
                {mode !== "hourly" && mode !== "cron" && schedule.hours.length > 1 && (
                    <p className="text-xs text-muted-foreground">Every time starts at the same minute, since cron has one minute for all of them.</p>
                )}

                {mode === "cron" && (
                    <div className="grid gap-1.5">
                        <Input
                            value={cronText}
                            onChange={(event) => {
                                setCronText(event.target.value);
                                onChange(event.target.value.trim());
                            }}
                            placeholder="0 3 * * *"
                            aria-label="Cron expression"
                            aria-invalid={!valid || undefined}
                            spellCheck={false}
                            autoComplete="off"
                            className="font-mono"
                        />
                        <p className="text-xs text-muted-foreground">Minute, hour, day of the month, month and weekday, in the time zone of the scheduler.</p>
                        {!valid && (
                            <p className="flex items-center gap-1.5 text-xs text-destructive">
                                <CircleAlert className="size-3.5 shrink-0" aria-hidden="true" />
                                {cronFields === 5 || cronFields === 6
                                    ? "The scheduler cannot read this expression."
                                    : "Needs five parts, like 0 3 * * * for every day at 03:00."}
                            </p>
                        )}
                    </div>
                )}
            </div>

            {clash && load && (
                <ClashNote
                    clash={clash}
                    slots={load.slots}
                    timezone={load.timezone}
                    together={owners.durations.length}
                    action={
                        suggestion && (
                            <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => update(suggestion.schedule)}>
                                {suggestion.label}
                            </Button>
                        )
                    }
                />
            )}
            <ScheduleSummary words={words} timezone={timezone} nextRuns={nextRuns} oneTime={mode !== "hourly" && mode !== "cron" && schedule.hours.length === 1} />
        </div>
    );
}
