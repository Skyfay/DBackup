"use client";

import { useState } from "react";
import { CalendarClock, Trash } from "lucide-react";
import { toast } from "sonner";
import { DialogItemList } from "@/components/ui/confirm-dialog";
import { TrashConfirmDialog, toastMovedToTrash, useTrashUntil } from "@/components/ui/delete-mode";
import { useTrash } from "@/components/trash/use-trash";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import type { JobListItem } from "@/services/jobs/job-list-service";
import { describeSchedule } from "./job-schedule";

const log = logger.child({ component: "job-delete-dialog" });

interface JobDeleteDialogProps {
    job: JobListItem;
    onClose: () => void;
    onDeleted: (id: string) => void;
    /** After Undo brought it back, to load the list again. */
    onRestored: () => void | Promise<void>;
}

/**
 * Asks before deleting one job, then moves it to Recently deleted or deletes it at once. It looks
 * like the bulk confirmation.
 */
export function JobDeleteDialog({ job, onClose, onDeleted, onRestored }: JobDeleteDialogProps) {
    const [pending, setPending] = useState(false);
    const trash = useTrash("job", onRestored);
    const until = useTrashUntil(trash.days);

    const remove = async (permanently: boolean) => {
        setPending(true);
        try {
            const res = await fetch(`/api/jobs/${encodeURIComponent(job.id)}${permanently ? "?permanently=true" : ""}`, { method: "DELETE" });
            const data = await res.json().catch(() => null);
            if (res.ok && data?.success) {
                if (permanently) toast.success("Job deleted");
                else toastMovedToTrash(`${job.name} moved to Recently deleted`, trash.days, () => trash.undo([job.id]));
                onDeleted(job.id);
            } else {
                toast.error(data?.error || "The job could not be deleted.");
            }
        } catch (error) {
            log.error("Deleting a job failed", { jobId: job.id }, wrapError(error));
            toast.error("The job could not be deleted.");
        } finally {
            setPending(false);
            onClose();
        }
    };

    return (
        <TrashConfirmDialog
            onOpenChange={(open) => !open && onClose()}
            icon={Trash}
            title="Delete job?"
            description="Backups the job already stored stay where they are."
            confirmLabel="Delete job"
            days={trash.days}
            canDeletePermanently={trash.canDeletePermanently}
            restoreLine={job.enabled ? `Restore it until ${until} and it runs on its schedule again.` : undefined}
            permanentLine="It skips Recently deleted. Its runs stay in History without their job."
            permanentNotice={`${job.name} is gone at once. DBackup keeps no copy of it anywhere.`}
            isPending={pending}
            onConfirm={(permanently) => void remove(permanently)}
        >
            <DialogItemList items={[{ name: job.name, detail: describeSchedule(job.schedulePreset?.schedule ?? job.schedule).text, icon: CalendarClock }]} />
        </TrashConfirmDialog>
    );
}
