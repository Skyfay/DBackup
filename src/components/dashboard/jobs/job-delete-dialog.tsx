"use client";

import { useState } from "react";
import { CalendarClock, Trash } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog, DialogItemList } from "@/components/ui/confirm-dialog";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import type { JobListItem } from "@/services/jobs/job-list-service";
import { describeSchedule } from "./job-schedule";

const log = logger.child({ component: "job-delete-dialog" });

interface JobDeleteDialogProps {
    job: JobListItem;
    onClose: () => void;
    onDeleted: (id: string) => void;
}

/** Asks before deleting one job, then deletes it. It looks like the bulk confirmation. */
export function JobDeleteDialog({ job, onClose, onDeleted }: JobDeleteDialogProps) {
    const [pending, setPending] = useState(false);

    const remove = async () => {
        setPending(true);
        try {
            const res = await fetch(`/api/jobs/${encodeURIComponent(job.id)}`, { method: "DELETE" });
            const data = await res.json().catch(() => null);
            if (res.ok && data?.success) {
                toast.success("Job deleted");
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
        <ConfirmDialog
            open
            onOpenChange={(open) => !open && onClose()}
            icon={Trash}
            destructive
            title="Delete job?"
            note="Cannot be undone"
            description="Backups the job already stored stay where they are."
            confirmLabel="Delete job"
            isPending={pending}
            onConfirm={remove}
        >
            <DialogItemList items={[{ name: job.name, detail: describeSchedule(job.schedulePreset?.schedule ?? job.schedule).text, icon: CalendarClock }]} />
        </ConfirmDialog>
    );
}
