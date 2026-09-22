"use client";

import * as React from "react";
import { AlertTriangle, Info, Loader2 } from "lucide-react";
import {
    AlertDialog,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

type IconComponent = React.ComponentType<{ className?: string }>;

const TONES = {
    destructive: "bg-destructive/12 text-destructive",
    warning: "bg-warning/12 text-warning",
    neutral: "bg-muted text-foreground",
};

/** The tinted tile beside the title of a confirmation or a report. */
export function DialogIcon({ icon: Icon, tone }: { icon: IconComponent; tone: keyof typeof TONES }) {
    return (
        <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", TONES[tone])} aria-hidden="true">
            <Icon className="size-4" />
        </span>
    );
}

export interface DialogListItem {
    name: string;
    /** A short muted fact after the name, such as the type of a connection. */
    detail?: string;
    /** A line under the name, such as why it failed. */
    description?: string;
    icon?: IconComponent;
}

/** The records a confirmation or a report is about, one row each. It scrolls once it gets long. */
export function DialogItemList({ items }: { items: DialogListItem[] }) {
    return (
        // Block instead of Radix's `display: table` wrapper, so long names are cut off.
        <ScrollArea className="min-w-0 rounded-lg border *:data-[slot=scroll-area-viewport]:max-h-60 [&>[data-slot=scroll-area-viewport]>div]:block!">
            <ul className="divide-y text-sm">
                {items.map((item, index) => (
                    // Names are not unique, and the list never changes while it is open.
                    <DialogItem key={index} item={item} />
                ))}
            </ul>
        </ScrollArea>
    );
}

function DialogItem({ item }: { item: DialogListItem }) {
    const Icon = item.icon;
    return (
        <li className="flex min-w-0 items-start gap-2.5 px-3 py-2">
            {Icon && <Icon className="mt-0.5 size-4 shrink-0" />}
            <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-baseline gap-2">
                    <span className="min-w-0 flex-1 truncate font-medium" title={item.name}>
                        {item.name}
                    </span>
                    {item.detail && <span className="shrink-0 text-xs text-muted-foreground">{item.detail}</span>}
                </div>
                {item.description && <p className="mt-0.5 text-muted-foreground">{item.description}</p>}
            </div>
        </li>
    );
}

export interface ConfirmDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    description: React.ReactNode;
    /** Shown in the tile beside the title. Falls back to a warning or an info sign. */
    icon?: IconComponent;
    confirmLabel?: string;
    destructive?: boolean;
    /** Keeps the dialog open with a spinner while the action runs. */
    isPending?: boolean;
    /** Blocks the confirm button, for example when nothing is left to act on. */
    disabled?: boolean;
    onConfirm: () => void;
    /** What the action touches, usually a DialogItemList. */
    children?: React.ReactNode;
}

/**
 * Asks before an action. The title asks the question, the description says what follows,
 * and the body shows what the action touches. Focus starts on Cancel, so Enter never
 * confirms by accident.
 */
export function ConfirmDialog({
    open,
    onOpenChange,
    title,
    description,
    icon,
    confirmLabel = "Confirm",
    destructive = false,
    isPending = false,
    disabled = false,
    onConfirm,
    children,
}: ConfirmDialogProps) {
    return (
        <AlertDialog open={open} onOpenChange={(next) => !isPending && onOpenChange(next)}>
            <AlertDialogContent className="gap-0 overflow-hidden rounded-xl p-0 sm:max-w-md">
                {/* The content is a grid, whose items default to min-width:auto. Without min-w-0
                    a long name would widen the dialog instead of being cut off. */}
                <div className="grid min-w-0 gap-4 p-5">
                    <AlertDialogHeader className="flex-row items-start gap-3 text-left">
                        <DialogIcon icon={icon ?? (destructive ? AlertTriangle : Info)} tone={destructive ? "destructive" : "neutral"} />
                        <div className="min-w-0 space-y-1">
                            <AlertDialogTitle className="text-base">{title}</AlertDialogTitle>
                            <AlertDialogDescription>{description}</AlertDialogDescription>
                        </div>
                    </AlertDialogHeader>
                    {children}
                </div>
                <AlertDialogFooter className="border-t bg-muted/30 px-5 py-3">
                    <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
                    {/* A plain button, since the Radix action would close the dialog before the action ran. */}
                    <Button variant={destructive ? "destructive" : "default"} disabled={isPending || disabled} onClick={onConfirm}>
                        {isPending && <Loader2 className="animate-spin" />}
                        {confirmLabel}
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
