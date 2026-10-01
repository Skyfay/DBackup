"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Play } from "lucide-react";
import { toast } from "sonner";
import { runSystemTaskAction, saveSystemTaskAction } from "@/app/actions/settings/system-tasks";
import { runHref } from "@/components/dashboard/history/run-links";
import { BackupContextMenu, BackupRowMenu } from "@/components/dashboard/storage/explorer/backup-menus";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { QuickFilter } from "@/components/ui/quick-filter";
import { useUserPreferences } from "@/hooks/use-user-preferences";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import type { IntegritySettings, SystemTaskRow } from "@/services/system/settings-types";
import { PartFrame, useSettingsFrame } from "./settings-frame";
import type { SettingsPartId } from "./settings-parts";
import { TaskDialog } from "./task-dialog";
import { TaskTile, hasProblem, scheduleWords, taskActions, taskColumns, type TaskHandlers } from "./task-columns";

const log = logger.child({ component: "tasks-part" });

type TaskFilter = "all" | "on" | "off" | "problem";

const FILTERS: Record<TaskFilter, (task: SystemTaskRow) => boolean> = {
    all: () => true,
    on: (task) => task.enabled,
    off: (task) => !task.enabled,
    problem: hasProblem,
};

interface TasksPartProps {
    tasks: SystemTaskRow[];
    integrity: IntegritySettings;
    /** A task to open right away, when the search picked it. */
    openTaskId: string | null;
    onOpened: () => void;
    onOpenPart: (part: SettingsPartId) => void;
}

/** Every system task with its schedule in words, its last run and its switch. A row opens its Edit dialog. */
export function TasksPart({ tasks, integrity, openTaskId, onOpened, onOpenPart }: TasksPartProps) {
    const router = useRouter();
    const { readOnly } = useSettingsFrame();
    const { autoRedirectOnJobStart } = useUserPreferences();
    const [filter, setFilter] = useState<TaskFilter>("all");
    const [editing, setEditing] = useState<string | null>(null);
    const [switching, setSwitching] = useState<string | null>(null);

    useEffect(() => {
        if (!openTaskId) return;
        setEditing(openTaskId);
        onOpened();
    }, [openTaskId, onOpened]);

    const run = useCallback(async (task: SystemTaskRow) => {
        try {
            const result = await runSystemTaskAction(task.id);
            if (!result.success) {
                toast.error(result.error || `${task.name} could not start.`);
                return;
            }
            if (result.executionId && autoRedirectOnJobStart) {
                router.push(runHref(result.executionId, "settings"));
                return;
            }
            toast.success(`${task.name} started`);
            router.refresh();
        } catch (error: unknown) {
            log.warn("Starting a system task failed", { taskId: task.id }, wrapError(error));
            toast.error(`${task.name} could not start.`);
        }
    }, [autoRedirectOnJobStart, router]);

    const switchTask = useCallback(async (task: SystemTaskRow, enabled: boolean) => {
        setSwitching(task.id);
        try {
            const result = await saveSystemTaskAction(task.id, { enabled });
            if (!result.success) {
                toast.error(result.error);
                return;
            }
            router.refresh();
        } catch (error: unknown) {
            log.warn("Switching a system task failed", { taskId: task.id }, wrapError(error));
            toast.error(`${task.name} could not be switched.`);
        } finally {
            setSwitching(null);
        }
    }, [router]);

    const handlers = useMemo<TaskHandlers>(() => ({
        ...(readOnly ? {} : { onEdit: (task) => setEditing(task.id), onRun: (task) => void run(task), onSwitch: (task, enabled) => void switchTask(task, enabled) }),
        onOpenRun: (task) => task.lastRun?.executionId && router.push(runHref(task.lastRun.executionId, "settings")),
        onOpenPart: (task) => task.follows && onOpenPart(task.follows.part),
    }), [readOnly, run, switchTask, router, onOpenPart]);

    const columns = useMemo(() => taskColumns({
        handlers,
        switching,
        renderActions: (task) => (
            <>
                {handlers.onRun && (
                    <Button variant="ghost" className="size-8 p-0" onClick={() => handlers.onRun?.(task)} disabled={task.running} aria-label={`Run ${task.name} now`}>
                        <Play />
                    </Button>
                )}
                <BackupRowMenu name={task.name} groups={taskActions(task, handlers)} />
            </>
        ),
    }), [handlers, switching]);

    const shown = useMemo(() => tasks.filter(FILTERS[filter]), [tasks, filter]);
    const count = (key: TaskFilter) => tasks.filter(FILTERS[key]).length;
    const problems = count("problem");
    const task = editing ? tasks.find((entry) => entry.id === editing) ?? null : null;

    return (
        <PartFrame part="tasks" flush>
            <DataTable
                frameless
                columns={columns}
                data={shown}
                searchKey="name"
                searchPlaceholder="Search tasks"
                getRowId={(entry) => entry.id}
                onRowClick={handlers.onEdit}
                activeRowId={editing}
                toolbarExtra={
                    <QuickFilter
                        value={filter}
                        onChange={setFilter}
                        aria-label="Show the tasks"
                        options={[
                            { value: "all", label: "All", count: tasks.length },
                            { value: "on", label: "On", count: count("on") },
                            { value: "off", label: "Off", count: count("off") },
                            ...(problems > 0 || filter === "problem" ? [{ value: "problem" as const, label: "A problem", count: problems, dot: "bg-warning" }] : []),
                        ]}
                    />
                }
                renderRowMenu={(entry, bulk) => (
                    <BackupContextMenu tile={<TaskTile taskId={entry.id} />} title={entry.name} note={scheduleWords(entry.schedule)} groups={taskActions(entry, handlers)} bulk={bulk} />
                )}
            />
            <TaskDialog task={task} integrity={integrity} onOpenChange={(open) => !open && setEditing(null)} onRun={(entry) => void run(entry)} />
        </PartFrame>
    );
}
