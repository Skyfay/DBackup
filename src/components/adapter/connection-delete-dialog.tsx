"use client";

import { useState } from "react";
import { Trash } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog, DialogItemList } from "@/components/ui/confirm-dialog";
import { logger } from "@/lib/logging/logger";
import type { AdapterConfig } from "./types";
import { kindNames } from "./connection-columns";
import { adapterTypeIcon } from "./connection-type-icon";

const log = logger.child({ component: "connection-delete-dialog" });

interface ConnectionDeleteDialogProps {
    config: AdapterConfig;
    onClose: () => void;
    onDeleted: (id: string) => void;
}

/**
 * Asks before deleting one connection, then deletes it. It looks like the bulk confirmation.
 * A connection still in use never gets here, see `deleteBlocker`.
 */
export function ConnectionDeleteDialog({ config, onClose, onDeleted }: ConnectionDeleteDialogProps) {
    const [pending, setPending] = useState(false);

    const remove = async () => {
        setPending(true);
        try {
            const res = await fetch(`/api/adapters/${config.id}`, { method: "DELETE" });
            const data = await res.json();
            if (res.ok && data.success) {
                toast.success("Connection deleted");
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
        <ConfirmDialog
            open
            onOpenChange={(open) => !open && onClose()}
            icon={Trash}
            destructive
            title="Delete connection?"
            note="Cannot be undone"
            confirmLabel="Delete connection"
            isPending={pending}
            onConfirm={remove}
        >
            <DialogItemList
                items={[{ name: config.name, detail: kindNames.get(config.adapterId) ?? config.adapterId, icon: adapterTypeIcon(config.adapterId) }]}
            />
        </ConfirmDialog>
    );
}
