"use client";

import * as React from "react";
import { Hourglass, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog, type ConfirmDialogProps } from "@/components/ui/confirm-dialog";
import { Label } from "@/components/ui/label";
import { useDateFormatter } from "@/hooks/use-date-formatter";
import { cn } from "@/lib/utils";

/**
 * The parts every delete shares, now that a deleted record waits in Recently deleted: where it goes
 * and until when it comes back, the tick that deletes it for good at once and what that loses, and
 * the toast with Undo after it. The bulk confirmation of a table uses them through `trash` on its
 * `BulkAction`, a single delete through `TrashConfirmDialog`.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** How long a toast with Undo stays, longer than a plain one so there is time to click it. */
const UNDO_MS = 10_000;

export const daysText = (days: number) => (days === 1 ? "1 day" : `${days} days`);

/** The day Recently deleted lets go of what is deleted now, in the format of the viewer. */
export function useTrashUntil(days: number): string {
    const { formatDate } = useDateFormatter();
    return formatDate(new Date(Date.now() + days * DAY_MS), "P");
}

interface TrashNoteProps {
    days: number;
    /** Several records, "They move" instead of "It moves". */
    many?: boolean;
    /** Who moves instead of "It", like the name of a user. */
    subject?: string;
    /** The sentence after it, like what a restore brings back. Says until when it can come back when left out. */
    children?: React.ReactNode;
}

/** Where a deleted record goes and for how long. */
export function TrashNote({ days, many = false, subject, children }: TrashNoteProps) {
    const until = useTrashUntil(days);
    return (
        <div className="flex items-start gap-2.5 rounded-lg border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">
            <Hourglass className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <p className="min-w-0">
                {subject ?? (many ? "They" : "It")} {many ? "move" : "moves"} to <span className="font-medium text-foreground">Recently deleted</span> under Settings for {daysText(days)}.{" "}
                {children ?? `Restore ${many ? "them" : "it"} until ${until} from there.`}
            </p>
        </div>
    );
}

interface PermanentTickProps {
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
    many?: boolean;
    /** What deleting at once loses, under the tick. */
    children?: React.ReactNode;
}

/** The tick that skips Recently deleted. Once ticked it frames itself in red, like the dialog around it. */
export function PermanentTick({ checked, onCheckedChange, many = false, children }: PermanentTickProps) {
    const id = React.useId();
    return (
        <div className={cn("flex items-start gap-3 rounded-lg border p-3 transition-colors", checked && "border-destructive/40 bg-destructive/5")}>
            <Checkbox id={id} checked={checked} onCheckedChange={(value) => onCheckedChange(value === true)} className="mt-0.5" />
            <div className="grid min-w-0 gap-1">
                <Label htmlFor={id} className="text-sm leading-snug font-semibold">
                    {many ? "Delete them permanently now" : "Delete it permanently now"}
                </Label>
                {children && <p className="text-xs leading-relaxed text-muted-foreground">{children}</p>}
            </div>
        </div>
    );
}

/** The red notice of a delete that skips Recently deleted. */
export function PermanentNotice({ children }: { children: React.ReactNode }) {
    return (
        <div className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
            <div className="grid min-w-0 gap-0.5">
                <p className="font-medium">This cannot be undone</p>
                <p className="text-muted-foreground">{children}</p>
            </div>
        </div>
    );
}

/** The toast after a delete into Recently deleted, with Undo while it shows. */
export function toastMovedToTrash(title: string, days: number, undo: () => void) {
    toast.success(title, {
        description: `Under Settings, for ${daysText(days)}`,
        duration: UNDO_MS,
        action: { label: "Undo", onClick: undo },
    });
}

interface TrashConfirmDialogProps extends Omit<ConfirmDialogProps, "open" | "destructive" | "tone" | "note" | "title" | "confirmLabel" | "onConfirm" | "children"> {
    /** Like "Delete job?". With the tick it asks to delete permanently. */
    title: string;
    /** The note under the title while the record goes to Recently deleted. */
    note?: string;
    /** Like "Delete job". With the tick it ends in "permanently". */
    confirmLabel: string;
    days: number;
    /** Offers the tick that deletes it at once, for a viewer who may skip Recently deleted. */
    canDeletePermanently: boolean;
    /** Who moves to Recently deleted instead of "It", like the name of a user. */
    subject?: string;
    /** The sentence after where it goes, like what a restore brings back. */
    restoreLine?: React.ReactNode;
    /** What deleting it at once loses, under the tick. */
    permanentLine: React.ReactNode;
    /** The red notice of the permanent delete, like who can no longer sign in. */
    permanentNotice: React.ReactNode;
    /** The record itself, usually a DialogItemList. */
    children?: React.ReactNode;
    /** What only the permanent delete shows, like the backups a key leaves unreadable. */
    permanentChildren?: React.ReactNode;
    onConfirm: (permanently: boolean) => void;
}

/**
 * Asks before a single record is deleted. It goes to Recently deleted in an amber dialog, and for a
 * viewer who may skip it the tick Delete it permanently now turns it red and deletes at once.
 */
export function TrashConfirmDialog({
    title,
    note,
    confirmLabel,
    days,
    canDeletePermanently,
    subject,
    restoreLine,
    permanentLine,
    permanentNotice,
    children,
    permanentChildren,
    onConfirm,
    ...props
}: TrashConfirmDialogProps) {
    const [permanently, setPermanently] = React.useState(false);
    const tick = canDeletePermanently && (
        <PermanentTick checked={permanently} onCheckedChange={setPermanently}>
            {permanentLine}
        </PermanentTick>
    );

    return (
        <ConfirmDialog
            {...props}
            open
            title={permanently ? permanentTitle(title) : title}
            note={permanently ? "It skips Recently deleted" : note}
            confirmLabel={permanently ? `${confirmLabel} permanently` : confirmLabel}
            destructive={permanently}
            tone={permanently ? "destructive" : "warning"}
            onConfirm={() => onConfirm(permanently)}
        >
            {children}
            {permanently ? (
                <>
                    {permanentChildren}
                    {tick}
                    <PermanentNotice>{permanentNotice}</PermanentNotice>
                </>
            ) : (
                <>
                    <TrashNote days={days} subject={subject}>{restoreLine}</TrashNote>
                    {tick}
                </>
            )}
        </ConfirmDialog>
    );
}

/** "Delete job?" as "Delete job permanently?". */
export function permanentTitle(title: string): string {
    return title.endsWith("?") ? `${title.slice(0, -1)} permanently?` : `${title} permanently`;
}
