"use client";

import * as React from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogIcon, DialogItemList } from "@/components/ui/confirm-dialog";
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import type { BulkFailure } from "@/lib/core/bulk";

export interface BulkResultDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    failures: BulkFailure[];
}

/**
 * The rows a bulk action could not process, with the reason for each.
 *
 * A plain Dialog rather than an AlertDialog: this reports what already happened and asks
 * for no decision. The reasons here are long and actionable, such as which jobs still use
 * a connection, which is exactly what a toast would truncate and then dismiss.
 */
export function BulkResultDialog({ open, onOpenChange, title, failures }: BulkResultDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent showCloseButton={false} className="gap-0 rounded-xl p-0 sm:max-w-md">
                <div className="flex min-w-0 flex-col gap-4 p-5">
                    <DialogHeader className="flex-row items-start gap-3 text-left">
                        <DialogIcon icon={AlertTriangle} tone="warning" />
                        <div className="min-w-0 space-y-1">
                            <DialogTitle className="text-base">{title}</DialogTitle>
                            <DialogDescription>
                                {failures.length === 1
                                    ? "One entry could not be processed."
                                    : `${failures.length} entries could not be processed.`}
                            </DialogDescription>
                        </div>
                    </DialogHeader>

                    <DialogItemList
                        items={failures.map((failure) => ({ name: failure.name ?? failure.id, description: failure.error }))}
                    />
                </div>
                <DialogFooter className="border-t bg-muted/30 px-5 py-3">
                    <DialogClose asChild>
                        <Button variant="outline">Close</Button>
                    </DialogClose>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
