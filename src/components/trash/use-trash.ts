"use client";

import { useMemo } from "react";
import { useCan } from "@/components/permissions/permissions-context";
import { TRASH_ADMIN_PERMISSION } from "@/lib/auth/permissions";
import type { TrashKind } from "@/services/trash/trash-types";
import { useTrashDays } from "./trash-days";
import { useUndoDelete } from "./use-undo-delete";

/** What a delete of one kind needs to know about Recently deleted, for its dialog and its bulk action. */
export interface TrashOptions {
    /** How long Recently deleted keeps what is deleted now. */
    days: number;
    /** Brings back what the viewer just deleted, for Undo in the toast. */
    undo: (ids: string[]) => void;
    /** Whether the viewer may skip Recently deleted, which needs the right to change the settings. */
    canDeletePermanently: boolean;
}

/** The Recently deleted side of a delete of this kind. `onRestored` loads the list again after Undo. */
export function useTrash(kind: TrashKind, onRestored?: () => void | Promise<void>): TrashOptions {
    const days = useTrashDays();
    const undoDelete = useUndoDelete(kind, onRestored);
    const canDeletePermanently = useCan(TRASH_ADMIN_PERMISSION);
    return useMemo(() => ({ days, undo: (ids: string[]) => void undoDelete(ids), canDeletePermanently }), [days, undoDelete, canDeletePermanently]);
}
