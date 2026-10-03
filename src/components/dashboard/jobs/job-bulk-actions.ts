import { CirclePause, CirclePlay, Trash2 } from "lucide-react";
import type { BulkAction, BulkTrash } from "@/components/ui/data-table";
import { requestBulk } from "@/lib/bulk-request";
import type { JobListItem } from "@/services/jobs/job-list-service";

/**
 * What a selection of jobs can do at once. Nothing without the right to change jobs. A delete moves
 * them to Recently deleted, `trash` holds how long and the Undo.
 */
export function jobBulkActions(canManage: boolean, trash: Omit<BulkTrash<JobListItem>, "permanentLine">): BulkAction<JobListItem>[] {
    if (!canManage) return [];

    const run = (action: "delete" | "enable" | "disable", rows: JobListItem[], permanently = false) =>
        requestBulk("/api/jobs/bulk", { action, ids: rows.map((job) => job.id), ...(permanently ? { permanently } : {}) });

    return [
        {
            id: "enable",
            labels: { verb: "resume", verbPast: "resumed", noun: "job" },
            icon: CirclePlay,
            // Nothing to do when every selected job already runs on its schedule.
            isAvailable: (rows) => rows.some((job) => !job.enabled),
            itemName: (job) => job.name,
            run: (rows) => run("enable", rows),
        },
        {
            id: "pause",
            labels: { verb: "pause", verbPast: "paused", noun: "job" },
            icon: CirclePause,
            isAvailable: (rows) => rows.some((job) => job.enabled),
            itemName: (job) => job.name,
            run: (rows) => run("disable", rows),
        },
        {
            id: "delete",
            labels: { verb: "delete", verbPast: "deleted", noun: "job" },
            icon: Trash2,
            variant: "destructive",
            itemName: (job) => job.name,
            confirm: {
                title: (rows) => `Delete ${rows.length} job${rows.length === 1 ? "" : "s"}?`,
                description: () => "Backups the jobs already stored stay where they are.",
                confirmLabel: "Delete",
            },
            trash: {
                ...trash,
                permanentLine: (rows) => (rows.length === 1
                    ? "It skips Recently deleted. Its runs stay in History without the job."
                    : "They skip Recently deleted. Their runs stay in History without their job."),
            },
            run: (rows, { permanently }) => run("delete", rows, permanently),
        },
    ];
}
