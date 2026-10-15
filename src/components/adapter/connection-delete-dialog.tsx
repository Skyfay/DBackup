"use client";

import { useEffect, useState } from "react";
import { Building2, Trash } from "lucide-react";
import { toast } from "sonner";
import { getServerCustomers } from "@/app/actions/tenant/database-assignments";
import { DialogItemList } from "@/components/ui/confirm-dialog";
import { TrashConfirmDialog, toastMovedToTrash } from "@/components/ui/delete-mode";
import { useTrash } from "@/components/trash/use-trash";
import { logger } from "@/lib/logging/logger";
import type { AdapterConfig } from "./types";
import { kindNames } from "./connection-columns";
import { useConnectionSharing } from "./connection-sharing";
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
 * A server whose databases are given to tenants warns that they keep their backups to download only.
 */
export function ConnectionDeleteDialog({ config, onClose, onDeleted, onRestored }: ConnectionDeleteDialogProps) {
    const [pending, setPending] = useState(false);
    const trash = useTrash("connection", onRestored);
    const customers = useServerCustomers(config);

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
            {customers.length > 0 && (
                <p className="flex gap-2.5 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2.5 text-sm">
                    <Building2 className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
                    <span>
                        {listOf(customers)} {customers.length === 1 ? "keeps" : "keep"} the backups of {customers.length === 1 ? "its" : "their"} databases on this server to download only, a restore needs the server. A database moved to another server first restores there.
                    </span>
                </p>
            )}
        </TrashConfirmDialog>
    );
}

/** "Acme", "Acme and Globex", "Acme, Globex and Initech". */
function listOf(names: string[]): string {
    return names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The tenants that hold a database of a server now, while the servers of this tenant share databases. */
function useServerCustomers(config: AdapterConfig): string[] {
    const sharing = useConnectionSharing();
    const [customers, setCustomers] = useState<string[]>([]);
    const asks = sharing !== null && config.type === "database";
    useEffect(() => {
        if (!asks) return;
        let ignore = false;
        getServerCustomers(config.id)
            .then((result) => {
                if (!ignore && result.success) setCustomers(result.data);
            })
            .catch((error: unknown) => log.warn("Reading the tenants of a server failed", { configId: config.id }, error instanceof Error ? error : undefined));
        return () => {
            ignore = true;
        };
    }, [asks, config.id]);
    return asks ? customers : [];
}
