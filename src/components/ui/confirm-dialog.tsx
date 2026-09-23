"use client";

import * as React from "react";
import { AlertTriangle, Info, Loader2 } from "lucide-react";
import {
    AlertDialog,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

type IconComponent = React.ComponentType<{ className?: string }>;

export type DialogTone = "destructive" | "warning" | "success" | "info" | "neutral";

// The head is tinted like the banners on the Overview. The note under the title uses a darker
// red in light mode, since the red token misses 4.5:1 on the tint.
const TONES: Record<DialogTone, { head: string; tile: string; note: string }> = {
    destructive: {
        head: "border-destructive/20 bg-destructive/5 dark:bg-destructive/10",
        tile: "bg-destructive/12 text-destructive",
        note: "text-red-700 dark:text-destructive",
    },
    warning: {
        head: "border-warning/25 bg-warning/5 dark:bg-warning/10",
        tile: "bg-warning/12 text-warning",
        note: "text-warning",
    },
    success: {
        head: "border-success/20 bg-success/5 dark:bg-success/8",
        tile: "bg-success/12 text-success",
        note: "text-muted-foreground",
    },
    info: {
        head: "border-info/20 bg-info/5 dark:bg-info/10",
        tile: "bg-info/12 text-info",
        note: "text-info",
    },
    neutral: {
        head: "bg-muted/40",
        tile: "bg-muted text-foreground",
        note: "text-muted-foreground",
    },
};

/** Classes shared by the dialogs built on DialogHead: the raised surface and the button strip. */
export const DIALOG_SURFACE = "gap-0 overflow-hidden rounded-xl bg-card p-0 sm:max-w-md";
export const DIALOG_FOOTER = "border-t bg-page/60 px-5 py-3";

interface DialogHeadProps {
    tone: DialogTone;
    icon: IconComponent;
    /** Tighter padding for a popover. */
    className?: string;
    children: React.ReactNode;
}

/** The tinted head of a dialog or a popover: an icon tile, the title and a short note. */
export function DialogHead({ tone, icon: Icon, className, children }: DialogHeadProps) {
    return (
        <div className={cn("flex min-w-0 items-center gap-3 border-b px-5 py-4", TONES[tone].head, className)}>
            <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", TONES[tone].tile)} aria-hidden="true">
                <Icon className="size-4" />
            </span>
            <div className="grid min-w-0 gap-0.5">{children}</div>
        </div>
    );
}

/** The classes of the note under a dialog title, in the tone's color. */
export function dialogNoteClass(tone: DialogTone): string {
    return cn("text-xs font-medium", TONES[tone].note);
}

export interface DialogListItem {
    name: string;
    /** A short fact after the name, such as the type of a connection or why it is left out. */
    detail?: string;
    /** "warning" colors the detail, for an entry the action leaves out. */
    detailTone?: "muted" | "warning";
    /** A line under the name, such as why it failed. */
    description?: string;
    icon?: IconComponent;
}

/** The records a confirmation or a report is about, one row each. It scrolls once it gets long. */
export function DialogItemList({ items, size = "default" }: { items: DialogListItem[]; size?: "default" | "small" }) {
    return (
        // Block instead of Radix's `display: table` wrapper, so long names are cut off.
        <ScrollArea
            className={cn(
                "min-w-0 rounded-lg border [&>[data-slot=scroll-area-viewport]>div]:block!",
                size === "small" ? "*:data-[slot=scroll-area-viewport]:max-h-32" : "*:data-[slot=scroll-area-viewport]:max-h-60"
            )}
        >
            <ul className="divide-y text-sm">
                {items.map((item, index) => (
                    // Names are not unique, and the rows hold no state of their own.
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
                    {item.detail && (
                        <span className={cn("shrink-0 text-xs", item.detailTone === "warning" ? "text-warning" : "text-muted-foreground")}>
                            {item.detail}
                        </span>
                    )}
                </div>
                {item.description && <p className="mt-0.5 text-muted-foreground">{item.description}</p>}
            </div>
        </li>
    );
}

// A tinted red instead of a filled one. The text is darker in light mode for the same reason as the note.
const SOFT_DESTRUCTIVE =
    "border border-destructive/25 bg-destructive/10 text-red-700 hover:bg-destructive/15 dark:bg-destructive/15 dark:text-destructive dark:hover:bg-destructive/25";

export interface ConfirmDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    /** A short line under the title in the tone's color, such as "Cannot be undone". */
    note?: string;
    /** More context above the body. */
    description?: React.ReactNode;
    /** Shown in the tile of the head. Falls back to a warning or an info sign. */
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
 * Asks before an action. The head carries the tone, red for a destructive action, and the
 * body shows what the action touches. Focus starts on Cancel, so Enter never confirms by
 * accident.
 */
export function ConfirmDialog({
    open,
    onOpenChange,
    title,
    note,
    description,
    icon,
    confirmLabel = "Confirm",
    destructive = false,
    isPending = false,
    disabled = false,
    onConfirm,
    children,
}: ConfirmDialogProps) {
    const tone: DialogTone = destructive ? "destructive" : "neutral";
    // Screen readers announce the note, or the description when there is no note.
    const bodyText = description && (note ? <p className="text-sm text-muted-foreground">{description}</p> : <AlertDialogDescription>{description}</AlertDialogDescription>);

    return (
        <AlertDialog open={open} onOpenChange={(next) => !isPending && onOpenChange(next)}>
            <AlertDialogContent className={DIALOG_SURFACE} {...(!note && !description ? { "aria-describedby": undefined } : {})}>
                <DialogHead tone={tone} icon={icon ?? (destructive ? AlertTriangle : Info)}>
                    <AlertDialogTitle className="text-base">{title}</AlertDialogTitle>
                    {note && <AlertDialogDescription className={dialogNoteClass(tone)}>{note}</AlertDialogDescription>}
                </DialogHead>
                {/* The content is a grid, whose items default to min-width:auto. Without min-w-0
                    a long name would widen the dialog instead of being cut off. */}
                {(bodyText || children) && (
                    <div className="grid min-w-0 gap-4 px-5 py-4">
                        {bodyText}
                        {children}
                    </div>
                )}
                <AlertDialogFooter className={DIALOG_FOOTER}>
                    <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
                    {/* A plain button, since the Radix action would close the dialog before the action ran. */}
                    <Button
                        variant={destructive ? "destructive" : "default"}
                        className={cn(destructive && SOFT_DESTRUCTIVE)}
                        disabled={isPending || disabled}
                        onClick={onConfirm}
                    >
                        {isPending && <Loader2 className="animate-spin" />}
                        {confirmLabel}
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
