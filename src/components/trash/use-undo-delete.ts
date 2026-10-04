"use client";

import { useCallback } from "react";
import { toast } from "sonner";
import { undoDeleteAction } from "@/app/actions/settings/trash";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import type { TrashKind, TrashRestoreResult } from "@/services/trash/trash-types";

const log = logger.child({ component: "use-undo-delete" });

/**
 * Tells what a restore from Recently deleted did: what is back with what changed on the way, a name
 * that is taken now, and what failed. `names` names the entries a failure only knows by id.
 */
export function reportRestore(result: TrashRestoreResult, names: Map<string, string> = new Map()) {
    const { restored, conflicts, failed } = result;
    if (restored.length > 0) {
        const notes = restored.flatMap((entry) => entry.notes.map((note) => (restored.length === 1 ? note : `${entry.name}: ${note}`)));
        const title = restored.length === 1 ? `${restored[0].name} is back` : `${restored.length} entries are back`;
        if (notes.length > 0) toast.warning(title, { description: notes.join(" ") });
        else toast.success(title);
    }
    for (const conflict of conflicts) {
        toast.warning(conflict.message, { description: "Restore it under Settings, Recently deleted, with another name." });
    }
    if (failed.length === 1) toast.error(`${names.get(failed[0].id) ?? failed[0].name}: ${failed[0].error}`);
    else if (failed.length > 1) toast.error(`${failed.length} entries could not be restored.`, { description: failed[0].error });
}

/**
 * Undo in the toast after a delete: brings the records back and reloads the list through `onRestored`.
 */
export function useUndoDelete(kind: TrashKind, onRestored?: () => void | Promise<void>) {
    return useCallback(
        async (ids: string[]) => {
            try {
                const result = await undoDeleteAction(kind, ids);
                if (!result.success) {
                    toast.error(result.error);
                    return;
                }
                reportRestore(result.data);
            } catch (error) {
                log.warn("Undoing a delete failed", { kind, count: ids.length }, wrapError(error));
                toast.error("The delete could not be undone.");
                return;
            }
            await onRestored?.();
        },
        [kind, onRestored]
    );
}
