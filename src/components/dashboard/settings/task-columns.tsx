"use client";

import type { ColumnDef } from "@tanstack/react-table";
import {
    Activity,
    Archive,
    ArrowUpRight,
    Check,
    Database,
    Download,
    FileCheck2,
    FileCog,
    HardDrive,
    Pencil,
    Play,
    ShieldCheck,
    Timer,
    Trash2,
    WandSparkles,
    type LucideIcon,
} from "lucide-react";
import type { BackupActionGroup } from "@/components/dashboard/storage/explorer/backup-actions";
import { describeSchedule } from "@/components/dashboard/jobs/job-schedule";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { Switch } from "@/components/ui/switch";
import { cn, formatDuration } from "@/lib/utils";
import type { SystemTaskRow } from "@/services/system/settings-types";
import { partOf } from "./settings-parts";

const TASK_ICONS: Record<string, LucideIcon> = {
    "system.health_check": Activity,
    "system.stuck_execution_check": Timer,
    "system.update_db_versions": Database,
    "system.refresh_storage_stats": HardDrive,
    "system.warmup_storage_cache": Archive,
    "system.clean_audit_logs": Trash2,
    "system.check_for_updates": Download,
    "system.sync_permissions": ShieldCheck,
    "system.config_backup": FileCog,
    "system.integrity_check": FileCheck2,
    "system.optimize_database": WandSparkles,
};

export function taskIcon(taskId: string): LucideIcon {
    return TASK_ICONS[taskId] ?? Activity;
}

export function TaskTile({ taskId, className }: { taskId: string; className?: string }) {
    const Icon = taskIcon(taskId);
    return (
        <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted/50", className)} aria-hidden="true">
            <Icon className="size-4 text-muted-foreground" />
        </span>
    );
}

/** "Every day at 00:00", or the cron itself when it has no words. */
export function scheduleWords(cron: string): string {
    return describeSchedule(cron).text;
}

/** Whether the last run needs a look. */
export const hasProblem = (task: SystemTaskRow) => !!task.lastRun && !task.lastRun.ok;

function LastRunCell({ task }: { task: SystemTaskRow }) {
    if (task.running) {
        return (
            <span className="flex items-center gap-2 text-sm">
                <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-info" aria-hidden="true" />
                Running now
            </span>
        );
    }
    const run = task.lastRun;
    if (!run) return <span className="text-sm text-muted-foreground">Never</span>;
    const result = run.summary ?? (run.durationMs !== null ? `took ${formatDuration(run.durationMs)}` : null);
    return (
        <div className="flex min-w-0 items-start gap-2">
            <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", run.ok ? "bg-success" : "bg-warning")} aria-hidden="true" />
            <div className="min-w-0">
                <RelativeTime date={run.at} className="block text-sm" />
                {result && <p className={cn("truncate text-xs", run.ok ? "text-muted-foreground" : "text-warning")} title={result}>{result}</p>}
            </div>
        </div>
    );
}

function ScheduleCell({ task }: { task: SystemTaskRow }) {
    return (
        <div className="min-w-0">
            <p className="truncate text-sm">{scheduleWords(task.schedule)}</p>
            <p className="truncate text-xs text-muted-foreground">
                {!task.enabled ? (task.follows ? `off under ${partOf(task.follows.part).label}` : "off") : task.nextRunAt ? <>next <RelativeTime date={task.nextRunAt} /></> : "no next run"}
            </p>
        </div>
    );
}

export interface TaskHandlers {
    onEdit?: (task: SystemTaskRow) => void;
    onRun?: (task: SystemTaskRow) => void;
    onSwitch?: (task: SystemTaskRow, enabled: boolean) => void;
    onOpenRun: (task: SystemTaskRow) => void;
    onOpenPart: (task: SystemTaskRow) => void;
}

/** Everything a task can have done to it, for the button at the end of its row and the right click. */
export function taskActions(task: SystemTaskRow, handlers: TaskHandlers): BackupActionGroup[] {
    const { onEdit, onRun, onOpenRun, onOpenPart } = handlers;
    const manage = [
        ...(onEdit ? [{ id: "edit", label: "Edit", icon: Pencil, onSelect: () => onEdit(task), tone: "edit" as const }] : []),
        ...(onRun ? [{ id: "run", label: "Run now", icon: Play, onSelect: () => onRun(task), disabled: task.running, tone: "neutral" as const }] : []),
    ];
    const open = [
        ...(task.lastRun?.executionId ? [{ id: "last-run", label: "Open the last run", icon: ArrowUpRight, onSelect: () => onOpenRun(task), tone: "neutral" as const }] : []),
        ...(task.follows ? [{ id: "part", label: `Open ${partOf(task.follows.part).label}`, icon: ArrowUpRight, onSelect: () => onOpenPart(task), tone: "neutral" as const }] : []),
    ];
    return [...(manage.length > 0 ? [{ label: "Manage", actions: manage }] : []), ...(open.length > 0 ? [{ actions: open }] : [])];
}

interface ColumnOptions {
    handlers: TaskHandlers;
    /** The task whose switch is being saved. */
    switching: string | null;
    renderActions: (task: SystemTaskRow) => React.ReactNode;
}

/** The columns of the system tasks. */
export function taskColumns({ handlers, switching, renderActions }: ColumnOptions): ColumnDef<SystemTaskRow>[] {
    return [
        {
            accessorKey: "name",
            header: "Task",
            filterFn: (row, _id, value: string) => {
                const query = value.trim().toLowerCase();
                return !query || `${row.original.name} ${row.original.description}`.toLowerCase().includes(query);
            },
            cell: ({ row }) => (
                <div className="flex min-w-0 items-center gap-3">
                    <TaskTile taskId={row.original.id} />
                    <div className="min-w-0 max-w-md">
                        {handlers.onEdit ? (
                            <button type="button" onClick={() => handlers.onEdit?.(row.original)} className="truncate text-left text-sm font-medium outline-none hover:underline focus-visible:underline">
                                {row.original.name}
                            </button>
                        ) : (
                            <p className="truncate text-sm font-medium">{row.original.name}</p>
                        )}
                        <p className="truncate text-xs text-muted-foreground" title={row.original.description}>{row.original.description}</p>
                    </div>
                </div>
            ),
        },
        {
            id: "schedule",
            header: "Schedule",
            enableSorting: false,
            cell: ({ row }) => <div className="w-44"><ScheduleCell task={row.original} /></div>,
        },
        {
            id: "lastRun",
            header: "Last run",
            accessorFn: (task) => (task.lastRun ? Date.parse(task.lastRun.at) : 0),
            cell: ({ row }) => <div className="w-44"><LastRunCell task={row.original} /></div>,
        },
        {
            id: "runOnStartup",
            header: "On start",
            accessorFn: (task) => (task.runOnStartup ? 1 : 0),
            cell: ({ row }) =>
                row.original.runOnStartup ? <Check className="size-4 text-muted-foreground" aria-label="Runs when DBackup starts" /> : <span className="text-muted-foreground" aria-label="Not when DBackup starts">-</span>,
        },
        {
            id: "enabled",
            header: "On",
            accessorFn: (task) => (task.enabled ? 1 : 0),
            cell: ({ row }) => (
                <Switch
                    checked={row.original.enabled}
                    onCheckedChange={(checked) => handlers.onSwitch?.(row.original, checked)}
                    disabled={!handlers.onSwitch || switching === row.original.id}
                    aria-label={`${row.original.name} on its schedule`}
                />
            ),
        },
        {
            id: "actions",
            header: () => <span className="sr-only">Actions</span>,
            enableSorting: false,
            enableHiding: false,
            cell: ({ row }) => <div className="flex justify-end gap-0.5">{renderActions(row.original)}</div>,
        },
    ];
}
