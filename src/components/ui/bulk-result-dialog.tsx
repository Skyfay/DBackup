"use client";

import * as React from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DIALOG_FOOTER, DIALOG_SURFACE, DialogHead, DialogItemList, dialogNoteClass, type DialogListItem } from "@/components/ui/confirm-dialog";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";

export interface BulkResultDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Names what was not done, like "1 connection was not deleted". */
    title: string;
    /** How the rest went, like "7 of 8 deleted". */
    note: string;
    /** The rows that failed, each with its reason as the description. */
    failures: DialogListItem[];
}

/**
 * The rows a bulk action could not process, with the reason for each.
 *
 * A plain Dialog rather than an AlertDialog: this reports what already happened and asks
 * for no decision. The reasons here are long and actionable, such as which jobs still use
 * a connection, which is exactly what a toast would truncate and then dismiss.
 */
export function BulkResultDialog({ open, onOpenChange, title, note, failures }: BulkResultDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent showCloseButton={false} className={DIALOG_SURFACE}>
                <DialogHead tone="warning" icon={AlertTriangle}>
                    <DialogTitle className="text-base leading-6">{title}</DialogTitle>
                    <DialogDescription className={dialogNoteClass("warning")}>{note}</DialogDescription>
                </DialogHead>
                <div className="min-w-0 px-5 py-4">
                    <DialogItemList items={failures} />
                </div>
                <DialogFooter className={DIALOG_FOOTER}>
                    <DialogClose asChild>
                        <Button variant="outline">Close</Button>
                    </DialogClose>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
