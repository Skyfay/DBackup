"use client";

import { Archive, Check, Lock, RotateCcw, TriangleAlert } from "lucide-react";
import { AdapterIcon } from "@/components/adapter/adapter-icon";
import { kindNames } from "@/components/adapter/connection-columns";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useDateFormatter } from "@/hooks/use-date-formatter";
import { cn, formatBytes } from "@/lib/utils";
import type { SharedDatabase } from "@/services/tenant/shared-databases";
import { madeAt, madeAtText, othersOnServer, type SharedRow } from "./shared-model";

interface SharedRestoreDialogProps {
    row: SharedRow;
    /** Every database shared with the tenant, for the ones the restore leaves alone. */
    databases: SharedDatabase[];
    pending: boolean;
    onClose: () => void;
    onConfirm: () => void;
}

function Part({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <section className="min-w-0 space-y-2">
            <h3 className="text-sm font-semibold">{title}</h3>
            {children}
        </section>
    );
}

function Change({ icon: Icon, tone, title, line }: { icon: typeof Check; tone?: "warning"; title: string; line: string }) {
    return (
        <li className={cn("flex min-w-0 items-start gap-3 px-3 py-2.5", tone === "warning" && "bg-warning/5")}>
            <Icon className={cn("mt-0.5 size-4 shrink-0", tone === "warning" ? "text-warning" : "text-muted-foreground")} aria-hidden="true" />
            <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{title}</span>
                <span className="block text-xs text-muted-foreground">{line}</span>
            </span>
        </li>
    );
}

/**
 * Asks before a shared backup goes back into its database, in the amber of a warning. The backup
 * is the row picked in the list, so there is no date to pick, and the target is fixed: a shared
 * database restores only into itself. It says what is overwritten and what stays as it is.
 */
export function SharedRestoreDialog({ row, databases, pending, onClose, onConfirm }: SharedRestoreDialogProps) {
    const { formatDate } = useDateFormatter();
    const { database } = row;
    const when = formatDate(row.createdAt, "Pp");
    const kind = kindNames.get(database.adapterId) ?? database.adapterId;
    const facts = [row.dump ? formatBytes(row.dump.stored) : null, row.verification?.passed ? "verified" : row.verification ? "check failed" : null].filter(Boolean).join(" · ");
    const others = othersOnServer(databases, row);
    const made = madeAt(row);
    const name = database.databaseName;

    return (
        <ConfirmDialog
            open
            onOpenChange={(open) => !open && onClose()}
            tone="warning"
            icon={RotateCcw}
            title={`Restore ${name}`}
            note={`From the backup of ${when}`}
            confirmLabel={`Restore ${name}`}
            isPending={pending}
            onConfirm={onConfirm}
            className="sm:max-w-xl"
        >
            <Part title="Backup">
                <div className="flex min-w-0 items-center gap-3 rounded-lg border border-tone/40 bg-tone/5 px-3 py-2.5">
                    <Archive className="size-4 shrink-0 text-tone" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium tabular-nums">{when}</span>
                    {facts && <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{facts}</span>}
                </div>
                <p className="text-xs text-muted-foreground">
                    The backup picked in the list{made ? `, ${madeAtText(made, name)} before the database moved` : ""}. Another one restores from its own row.
                </p>
            </Part>

            <Part title="Restores into">
                <div className="flex min-w-0 items-center gap-3 rounded-lg border bg-muted/40 px-3 py-2.5">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-card" aria-hidden="true">
                        <AdapterIcon adapterId={database.adapterId} className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{name}</span>
                        <span className="block truncate text-xs text-muted-foreground">on {database.serverName} · {kind} · provided by {database.providerName}</span>
                    </span>
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-md border bg-card px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
                        <Lock className="size-3" aria-hidden="true" />
                        Fixed
                    </span>
                </div>
                <p className="text-xs text-muted-foreground">
                    A shared database restores only into itself. Another name or another server needs the dump: download it and restore it there yourself.
                </p>
            </Part>

            <Part title="What changes">
                <ul className="divide-y rounded-lg border">
                    <Change icon={TriangleAlert} tone="warning" title={`${name} is overwritten`} line={`What was written to it after ${when} is lost`} />
                    {others.map((other) => (
                        <Change key={other.databaseName} icon={Check} title={`${other.databaseName} stays as it is`} line="your other database on this server" />
                    ))}
                    <Change icon={Check} title={`Every other database of ${database.serverName} stays as it is`} line={`those of ${database.providerName} and of its other customers`} />
                </ul>
            </Part>

            <p className="text-xs text-muted-foreground">It runs in the queue of {database.providerName} and shows in your History.</p>
        </ConfirmDialog>
    );
}
