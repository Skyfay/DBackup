"use client";

import { useState } from "react";
import { Square } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { RunRow } from "@/services/history/run-types";
import { cancelRun } from "./run-actions";

type RunToCancel = Pick<RunRow, "id" | "name" | "type" | "status">;

/** What a cancel does to the run, said before it happens. */
export function cancelConsequence(run: RunToCancel): string {
    if (run.status === "Pending") return "It has not started yet and leaves the queue.";
    if (run.type === "Restore") return "The restore stops where it is, so the database it writes to may be left half restored.";
    return "The run stops where it is and ends as cancelled.";
}

/**
 * Asks before a live run stops, since a slip of the mouse would end a backup that ran for hours or
 * leave a restore halfway through its database. Null closes it.
 */
export function CancelRunDialog({ run, onClose, onCancelled }: { run: RunToCancel | null; onClose: () => void; onCancelled: () => void }) {
    const [pending, setPending] = useState(false);

    const confirm = async () => {
        if (!run) return;
        setPending(true);
        // cancelRun says in a toast how it went and never throws.
        const cancelled = await cancelRun(run.id);
        setPending(false);
        onClose();
        if (cancelled) onCancelled();
    };

    return (
        <ConfirmDialog
            open={run !== null}
            onOpenChange={(open) => !open && onClose()}
            title={run ? `Cancel ${run.name}?` : "Cancel the run?"}
            description={run ? cancelConsequence(run) : undefined}
            icon={Square}
            confirmLabel="Cancel run"
            cancelLabel={run?.status === "Pending" ? "Keep it waiting" : "Keep it running"}
            destructive
            isPending={pending}
            onConfirm={() => void confirm()}
        />
    );
}
