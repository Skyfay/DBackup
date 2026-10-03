"use client";

import { useState } from "react";
import { Trash } from "lucide-react";
import { toast } from "sonner";
import { DialogItemList } from "@/components/ui/confirm-dialog";
import { TrashConfirmDialog, toastMovedToTrash } from "@/components/ui/delete-mode";
import { useTrash } from "@/components/trash/use-trash";
import { logger } from "@/lib/logging/logger";
import type { AdapterConfig } from "./types";
import { kindNames } from "./connection-columns";
import { adapterTypeIcon } from "./connection-type-icon";

const log = logger.child({ component: "connection-delete-dialog" });

interface ConnectionDeleteDialogProps {
    config: AdapterConfig;
    onClose: () => void;
    onDeleted: (id: string) => void;
    /** After Undo brought it back, to load the list again. */
    onRestored: () => void | Promise<void>;
}

/**
 * Asks before deleting one connection, then moves it to Recently deleted or deletes it at once. It
 * looks like the bulk confirmation. A connection still in use never gets here, see `deleteBlocker`.
 */
export function ConnectionDeleteDialog({ config, onClose, onDeleted, onRestored }: ConnectionDeleteDialogProps) {
    const [pending, setPending] = useState(false);
    const trash = useTrash("connection", onRestored);

    const remove = async (permanently: boolean) => {
        setPending(true);
        try {
            const res = await fetch(`/api/adapters/${config.id}${permanently ? "?permanently=true" : ""}`, { method: "DELETE" });
            const data = await res.json();
            if (res.ok && data.success) {
                if (permanently) toast.success("Connection deleted");
                else toastMovedToTrash(`${config.name} moved to Recently deleted`, trash.days, () => trash.undo([config.id]));
                onDeleted(config.id);
            } else {
                // A connection still in use is refused with the names of what uses it.
                toast.error(data.error || "The connection could not be deleted.");
            }
        } catch (error) {
            log.error("Deleting a connection failed", { configId: config.id }, error instanceof Error ? error : undefined);
            toast.error("The connection could not be deleted.");
        } finally {
            setPending(false);
            onClose();
        }
    };

    return (
        <TrashConfirmDialog
            onOpenChange={(open) => !open && onClose()}
            icon={Trash}
            title="Delete connection?"
            confirmLabel="Delete connection"
            days={trash.days}
            canDeletePermanently={trash.canDeletePermanently}
            permanentLine="It skips Recently deleted, with the login it holds. Backups it stored stay where they are."
            permanentNotice={`${config.name} is gone at once. DBackup keeps no copy of it anywhere.`}
            isPending={pending}
            onConfirm={(permanently) => void remove(permanently)}
        >
            <DialogItemList
                items={[{ name: config.name, detail: kindNames.get(config.adapterId) ?? config.adapterId, icon: adapterTypeIcon(config.adapterId) }]}
            />
        </TrashConfirmDialog>
    );
}
