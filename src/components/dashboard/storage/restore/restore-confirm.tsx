"use client";

import { useEffect, useState } from "react";
import { Database, FolderOpen, RotateCcw } from "lucide-react";
import type { AdapterOption } from "@/components/dashboard/jobs/job-form-schema";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog, DialogItemList, type DialogListItem } from "@/components/ui/confirm-dialog";
import { Label } from "@/components/ui/label";
import { formatBytes } from "@/lib/utils";
import { customerNames, customerOverwrites, folderOutcome, plural, type DbRow, type FolderChoice } from "./restore-model";

const FOLDER_DETAIL = { replaces: "replaces files of the same name", emptied: "empties it first", empty: "an empty folder", unverified: "not checked", checking: "not checked yet" } as const;

interface RestoreConfirmProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    rows: DbRow[];
    /** The name an older backup of one dump goes into, empty for its original database. */
    singleDump: { name: string } | null;
    folders: FolderChoice[];
    targets: AdapterOption[];
    serverName: string | null;
    shapeOf: (configId: string) => { flat: boolean };
    label: string;
    pending: boolean;
    /** Starts the restore, with whether it overwrites databases customers hold, which the request has to confirm. */
    onConfirm: (overwriteCustomerDatabases: boolean) => void;
}

/**
 * Asks before a restore starts, in amber like every warning, and says what it does: each database
 * with the name it gets and whether it overwrites one, and each folder with where it goes. A database
 * a customer holds now on a shared server is marked, and the restore starts only once a tick confirms
 * overwriting those.
 */
export function RestoreConfirm({ open, onOpenChange, rows, singleDump, folders, targets, serverName, shapeOf, label, pending, onConfirm }: RestoreConfirmProps) {
    const [overwriteCustomers, setOverwriteCustomers] = useState(false);
    // Asked again every time the dialog opens.
    useEffect(() => {
        if (open) setOverwriteCustomers(false);
    }, [open]);
    const databases = rows.filter((row) => row.picked && row.source !== null);
    const held = customerOverwrites(rows);
    const customers = customerNames(held);
    const picked = folders.filter((folder) => folder.selected);
    const overwrites = databases.filter((row) => row.outcome === "overwrite").length;
    const replaces = picked.filter((folder) => {
        const outcome = folderOutcome(folder, shapeOf(folder.targetConfigId).flat);
        return outcome === "replaces" || outcome === "emptied";
    }).length;

    const items: DialogListItem[] = [
        ...databases.map<DialogListItem>((row) => ({
            name: row.source === row.target ? `${row.source}` : `${row.source} as ${row.target}`,
            detail: row.outcome === "overwrite" ? `overwrites${row.thereSize !== null ? ` ${formatBytes(row.thereSize)}` : ""}` : row.outcome === "unverified" ? "not checked" : "new",
            detailTone: row.outcome === "overwrite" ? "warning" : "muted",
            ...(row.customer !== undefined ? { description: row.customer ? `${row.customer} holds it` : "A customer holds it" } : {}),
            icon: Database,
        })),
        ...(singleDump ? [{ name: singleDump.name ? `The dump as ${singleDump.name}` : "The dump into its original database", detail: singleDump.name ? "" : "overwritten", detailTone: "warning" as const, icon: Database }] : []),
        ...picked.map<DialogListItem>((folder) => {
            const outcome = folderOutcome(folder, shapeOf(folder.targetConfigId).flat);
            const target = targets.find((entry) => entry.id === folder.targetConfigId)?.name ?? "a directory source";
            return {
                name: `${folder.label} to ${target}, ${folder.targetPath}`,
                detail: outcome in FOLDER_DETAIL ? FOLDER_DETAIL[outcome as keyof typeof FOLDER_DETAIL] : "",
                detailTone: outcome === "replaces" || outcome === "emptied" ? "warning" : "muted",
                icon: FolderOpen,
            };
        }),
    ];

    const parts = [
        overwrites > 0 ? `Overwrites ${plural(overwrites, "database")}` : null,
        singleDump && !singleDump.name ? "Overwrites the original database" : null,
        replaces > 0 ? `replaces files in ${plural(replaces, "folder")}` : null,
    ].filter(Boolean);
    const note = parts.length > 0 ? `${parts.join(", ")}, cannot be undone` : "Nothing there is overwritten";
    const title = (databases.length > 0 || singleDump) && serverName ? `Restore into ${serverName}?` : `Restore ${plural(picked.length, "folder")}?`;

    return (
        <ConfirmDialog
            open={open}
            onOpenChange={onOpenChange}
            title={title}
            note={note}
            tone="warning"
            icon={RotateCcw}
            confirmLabel={label}
            isPending={pending}
            disabled={held.length > 0 && !overwriteCustomers}
            onConfirm={() => onConfirm(held.length > 0 && overwriteCustomers)}
        >
            <DialogItemList items={items} />
            {held.length > 0 && (
                <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3">
                    <Checkbox id="restore-overwrite-customers" checked={overwriteCustomers} onCheckedChange={(on) => setOverwriteCustomers(on === true)} className="mt-0.5" />
                    <Label htmlFor="restore-overwrite-customers" className="block text-sm leading-snug font-normal">
                        Overwrite {held.length === 1 ? "the database" : `the ${held.length} databases`} of {customers.length > 0 ? customers.join(", ") : held.length === 1 ? "a customer" : "customers"}.
                        <span className="mt-0.5 block text-xs text-muted-foreground">{held.length === 1 ? "It is given to a customer, who loses what changed since the backup." : "They are given to customers, who lose what changed since the backup."} Their History shows nothing of it.</span>
                    </Label>
                </div>
            )}
            <p className="text-xs text-muted-foreground">It runs in the background. Its run shows in History with the log.</p>
        </ConfirmDialog>
    );
}
