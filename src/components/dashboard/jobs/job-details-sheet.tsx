"use client";

import { Sheet, SheetContent } from "@/components/ui/sheet";
import type { JobListItem } from "@/services/jobs/job-list-service";
import { JobDetailsContent, type JobDetailsProps } from "./job-details-content";

interface JobDetailsSheetProps extends Omit<JobDetailsProps, "job"> {
    open: boolean;
    /** Stays set while the panel slides out, so its content does not vanish halfway. */
    job: JobListItem | null;
    onClose: () => void;
}

/** The details of one job in a panel from the right, for the table and the cards. */
export function JobDetailsSheet({ open, job, onClose, ...props }: JobDetailsSheetProps) {
    return (
        <Sheet open={open && job !== null} onOpenChange={(next) => !next && onClose()}>
            <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-xl">
                {job && <JobDetailsContent job={job} {...props} />}
            </SheetContent>
        </Sheet>
    );
}
