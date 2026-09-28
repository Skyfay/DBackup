"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { describeSchedule } from "@/components/dashboard/jobs/job-schedule";
import { JobIcon } from "@/components/dashboard/storage/explorer/explorer-cells";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import type { DataTableFilterableColumn } from "@/components/ui/data-table";
import { DateDisplay } from "@/components/utils/date-display";
import { readCron } from "@/lib/core/cron";
import type { ScheduleRow, TemplateJob } from "@/services/templates/templates-types";
import { JobsStack, NameCell } from "./template-cells";
import { count } from "./template-format";

/** The jobs that follow a preset. */
export function followersOf(row: ScheduleRow, jobs: Map<string, TemplateJob>): TemplateJob[] {
    return row.jobIds.map((id) => jobs.get(id)).filter((job): job is TemplateJob => job !== undefined);
}

/** When a preset starts its jobs next, in the time zone of the scheduler. */
export function nextRunOf(row: ScheduleRow, timezone: string, now = new Date()): Date | null {
    return readCron(row.schedule, timezone)?.nextRun(now) ?? null;
}

/** The schedule in words with the cron expression under it. */
export function ScheduleWords({ schedule }: { schedule: string }) {
    return (
        <div className="min-w-0">
            <p className="truncate text-sm">{describeSchedule(schedule).text}</p>
            <p className="truncate font-mono text-xs text-muted-foreground">{schedule}</p>
        </div>
    );
}

interface ColumnOptions {
    jobs: Map<string, TemplateJob>;
    timezone: string;
    onOpen: (row: ScheduleRow) => void;
    renderActions: (row: ScheduleRow) => React.ReactNode;
}

/** The columns of the schedule presets. Name and actions stay put, the rest can move and hide. */
export function scheduleColumns({ jobs, timezone, onOpen, renderActions }: ColumnOptions): ColumnDef<ScheduleRow>[] {
    return [
        {
            accessorKey: "name",
            header: "Preset",
            meta: { pin: "start" },
            cell: ({ row, table }) => (
                <NameCell
                    kind="schedule"
                    name={row.original.name}
                    sub={row.original.description || "Schedule"}
                    compact={table.options.meta?.density === "compact"}
                    onOpen={() => onOpen(row.original)}
                />
            ),
        },
        {
            id: "runs",
            header: "Runs",
            cell: ({ row }) => <div className="max-w-64"><ScheduleWords schedule={row.original.schedule} /></div>,
        },
        {
            id: "next",
            header: "Next run",
            cell: ({ row }) => {
                const next = nextRunOf(row.original, timezone);
                return next ? <RelativeTime date={next} className="text-sm whitespace-nowrap" /> : <span className="text-sm text-muted-foreground">never</span>;
            },
        },
        {
            id: "usedBy",
            header: "Used by",
            // A preset counts once for each job in the numbers of the filter.
            accessorFn: (row) => row.jobIds,
            getUniqueValues: (row) => row.jobIds,
            filterFn: (row, id, value: string[]) => (row.getValue(id) as string[]).some((jobId) => value.includes(jobId)),
            cell: ({ row }) => {
                const followers = followersOf(row.original, jobs);
                return (
                    <div className="min-w-0 max-w-72">
                        <JobsStack jobs={followers} empty="no job follows it" />
                        {followers.length > 1 && <p className="mt-0.5 text-xs text-muted-foreground">{count(followers.length, "job")} start together</p>}
                    </div>
                );
            },
        },
        {
            id: "changed",
            header: "Changed",
            cell: ({ row }) => <RelativeTime date={row.original.updatedAt} className="text-sm whitespace-nowrap text-muted-foreground" />,
        },
        {
            id: "created",
            header: "Created",
            meta: { defaultHidden: true },
            cell: ({ row }) => <span className="text-sm whitespace-nowrap"><DateDisplay date={row.original.createdAt} format="P" /></span>,
        },
        {
            id: "actions",
            header: () => <span className="sr-only">Actions</span>,
            meta: { pin: "end", label: "Actions" },
            enableHiding: false,
            cell: ({ row }) => <div className="flex justify-end">{renderActions(row.original)}</div>,
        },
    ];
}

/** The Used by filter, with only the jobs that follow a preset. */
export function scheduleFilters(rows: ScheduleRow[], jobs: Map<string, TemplateJob>): DataTableFilterableColumn<ScheduleRow>[] {
    const used = [...new Set(rows.flatMap((row) => row.jobIds))].map((id) => jobs.get(id)).filter((job): job is TemplateJob => job !== undefined);
    return [
        {
            id: "usedBy",
            title: "Used by",
            note: "The numbers count the presets",
            unavailableLabel: "No presets with the other filters",
            contentClassName: "w-72",
            options: used
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((job) => ({
                    value: job.id,
                    label: job.name,
                    lead: <JobIcon job={{ kind: "job", sourceType: job.sourceType, hasFolders: job.hasFolders }} className="size-4 shrink-0" />,
                })),
        },
    ];
}
