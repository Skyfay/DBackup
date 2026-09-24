"use client";

import { useDeferredValue, useMemo } from "react";
import { useFormContext } from "react-hook-form";
import { Info, TriangleAlert } from "lucide-react";
import { formatInTimeZone } from "date-fns-tz";
import { BUILT_IN_PATTERN, firstNameClash, hasTimeOfDay, type NameClash } from "@/components/templates/naming-collisions";
import { NamingTemplatePicker } from "@/components/templates/naming-template-picker";
import { useNamingTemplates, type ListedNamingTemplate } from "@/components/templates/use-naming-templates";
import { Button } from "@/components/ui/button";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { nextRunTimes } from "@/lib/core/cron";
import { applyNamingPattern, fileNameParts, patternUsesChain } from "@/lib/templates/naming-template-engine";
import type { JobFormValues } from "./job-form-schema";
import { useSchedulerTimezone } from "./use-scheduler-timezone";

/** "Wed 25 Sep at 03:00 and 15:00", or both days when the runs fall on two. */
function whenOf(clash: NameClash, timezone: string): string {
    const day = (date: Date) => formatInTimeZone(date, timezone, "EEE d MMM");
    const time = (date: Date) => formatInTimeZone(date, timezone, "HH:mm");
    return day(clash.first) === day(clash.second)
        ? `${day(clash.first)} at ${time(clash.first)} and ${time(clash.second)}`
        : `${day(clash.first)} at ${time(clash.first)} and ${day(clash.second)} at ${time(clash.second)}`;
}

/**
 * The file names of a job: the naming template, a name the job will write, and a warning when two
 * runs of its schedule get the same name, since the later backup then replaces the earlier one at
 * every destination. An incremental job is safe, the position in its chain is part of every name.
 */
export function FileNamesField() {
    const form = useFormContext<JobFormValues>();
    const { templates, loading, saved } = useNamingTemplates();
    const timezone = useSchedulerTimezone();
    const value = form.watch("namingTemplateId") ?? null;
    const [name, scope, databases, schedule, enabled, mode, backupMode] = form.watch(["name", "databaseScope", "databases", "schedule", "enabled", "sourceMode", "backupMode"]);
    const chained = backupMode === "INCREMENTAL" && mode !== "db";

    const patternOf = (id: string | null): string =>
        (id ? templates.find((template) => template.id === id) : templates.find((template) => template.isDefault))?.pattern ?? BUILT_IN_PATTERN;
    const pattern = patternOf(value);

    // Working out the runs waits for typing to settle, so the schedule and the name stay quick.
    const deferredSchedule = useDeferredValue(schedule);
    const clash = useMemo(
        () => (timezone && enabled && !chained && !loading ? firstNameClash(pattern, deferredSchedule, timezone) : null),
        [timezone, enabled, chained, loading, pattern, deferredSchedule],
    );
    const safer: ListedNamingTemplate | undefined = useMemo(() => {
        if (!clash || !timezone) return undefined;
        const ordered = [...templates].sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
        return ordered.find((template) => template.id !== value && !firstNameClash(template.pattern, deferredSchedule, timezone));
    }, [clash, templates, value, deferredSchedule, timezone]);

    const example = useMemo(() => {
        if (!timezone) return null;
        // Like the saved job: no databases stands for all of them, and a job of folders has none.
        const parts = fileNameParts(name.trim() || "Job", mode !== "dirs" && scope === "some" ? databases : []);
        const at = (enabled && nextRunTimes(schedule, timezone, 1)[0]) || new Date();
        // An incremental job names its first backup with the start of the chain.
        const chain = chained ? "full-000" : "";
        const base = applyNamingPattern(pattern, parts.jobName, parts.dbName, at, timezone, chain);
        return `${chained && !patternUsesChain(pattern) ? "full-000-" : ""}${base}.tar`;
    }, [timezone, name, scope, databases, mode, enabled, schedule, chained, pattern]);

    return (
        <FormField
            control={form.control}
            name="namingTemplateId"
            render={({ field }) => (
                <FormItem>
                    <FormLabel>File names</FormLabel>
                    <FormControl>
                        <NamingTemplatePicker
                            templates={templates}
                            loading={loading}
                            value={field.value || null}
                            onChange={(id) => field.onChange(id ?? undefined)}
                            onSaved={saved}
                        />
                    </FormControl>
                    {example && (
                        <p className="min-w-0 truncate text-xs text-muted-foreground">
                            <span className="font-mono text-foreground">{example}</span> · {chained ? "the first backup of a chain" : "a backup of this job"}
                        </p>
                    )}
                    <FormMessage />

                    {clash && timezone && (
                        <div role="status" className="flex flex-wrap items-center gap-x-2.5 gap-y-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
                            <TriangleAlert className="size-4 shrink-0 text-warning" aria-hidden="true" />
                            <span className="min-w-0 flex-1">
                                The runs on {whenOf(clash, timezone)} get the same file name. The later backup replaces the earlier one at every destination, so the job
                                keeps fewer backups than it makes.
                            </span>
                            {safer && (
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="h-7 border-warning/50 bg-card text-xs hover:bg-warning/15 dark:border-warning/50 dark:bg-card dark:hover:bg-warning/20"
                                    onClick={() => field.onChange(safer.isDefault ? undefined : safer.id)}
                                >
                                    Use {safer.name}
                                </Button>
                            )}
                        </div>
                    )}
                    {!clash && !chained && !loading && !hasTimeOfDay(pattern) && (
                        <p className="flex gap-2 text-xs text-muted-foreground">
                            <Info className="mt-px size-3.5 shrink-0" aria-hidden="true" />
                            The name has no time of day, so a second run on the same day, like one started by hand, replaces the first backup.
                        </p>
                    )}
                </FormItem>
            )}
        />
    );
}
