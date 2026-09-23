"use client";

import { useEffect, useState } from "react";
import { FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DIALOG_FOOTER, DIALOG_SURFACE, DialogHead, dialogNoteClass } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { DirectoryTree, type DirectoryTreeRow } from "./directory-tree";

interface DirectoryBrowseDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    configId: string;
    connectionName: string;
    /** Every folder of this connection the job has, whichever row opened the dialog. */
    initialRows: DirectoryTreeRow[];
    onConfirm: (rows: DirectoryTreeRow[]) => void;
    /** This connection has nothing below its root, see DirectoryTree. */
    flat?: boolean;
    itemNoun?: string;
}

/**
 * Picks the folders of one connection for a job. It covers the whole connection, not just the
 * row that opened it: every folder the job already has from it is ticked, and confirming hands
 * back the full set, so a folder ticked off disappears from the job and a new one is added.
 *
 * "" is the tree's name for the root of the connection, while the form keeps the root as "/" so
 * the path field shows something. The two are swapped at this boundary only.
 */
export function DirectoryBrowseDialog({ open, onOpenChange, configId, connectionName, initialRows, onConfirm, flat = false, itemNoun = "item" }: DirectoryBrowseDialogProps) {
    const [rows, setRows] = useState<DirectoryTreeRow[]>([]);

    useEffect(() => {
        if (!open) return;
        // A flat connection has no root to pick, so a stored root row is dropped rather than
        // translated. Kept, it would be a row nobody can see and so nobody can untick.
        setRows(flat ? initialRows.filter((row) => row.path !== "/" && row.path !== "") : initialRows.map((row) => (row.path === "/" ? { ...row, path: "" } : row)));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const everything = !flat && rows.length === 1 && rows[0].path === "";
    const noun = flat ? itemNoun : "folder";
    const confirmLabel = everything ? "Back up everything" : rows.length > 1 ? `Use ${rows.length} ${noun}s` : `Use this ${noun}`;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent tone="pick" showCloseButton={false} className={cn(DIALOG_SURFACE, "flex h-[min(80vh,44rem)] flex-col sm:max-w-3xl")}>
                <DialogHead tone="pick" icon={FolderOpen}>
                    <DialogTitle className="text-base">Pick from {connectionName}</DialogTitle>
                    <DialogDescription className={cn(dialogNoteClass("pick"), "truncate")}>
                        {flat ? `Tick the ${itemNoun}s to back up, each one becomes a row of its own` : "Tick the folders to back up, or the root for everything"}
                    </DialogDescription>
                </DialogHead>
                <ScrollArea className="min-h-0 flex-1">
                    <div className="p-4">
                        {open && <DirectoryTree key={configId} configId={configId} rows={rows} onRowsChange={setRows} flat={flat} itemNoun={itemNoun} />}
                    </div>
                </ScrollArea>
                <div className={cn(DIALOG_FOOTER, "flex items-center justify-between gap-3")}>
                    <span className="text-xs text-muted-foreground">{rows.length === 0 ? `Nothing ticked yet` : `${rows.length} ticked`}</span>
                    <div className="flex gap-2">
                        <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                            Cancel
                        </Button>
                        <Button
                            type="button"
                            disabled={rows.length === 0}
                            onClick={() => {
                                // The root name only exists for a tree, a flat list never has an empty path.
                                onConfirm(flat ? rows : rows.map((row) => (row.path === "" ? { ...row, path: "/" } : row)));
                                onOpenChange(false);
                            }}
                        >
                            {confirmLabel}
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
