"use client";

import { AdapterIcon } from "@/components/adapter/adapter-icon";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { BackupFlags, IntegrityBadge } from "@/components/dashboard/storage/explorer/explorer-cells";
import { isPlainClick } from "@/components/ui/row-click";
import { DateDisplay } from "@/components/utils/date-display";
import { cn, formatBytes } from "@/lib/utils";
import { checkOf, FormerTag, ProviderChip } from "./shared-cells";
import { formerLabel, isFormer, madeAt, madeAtText, type SharedRow } from "./shared-model";

interface SharedCardProps {
    row: SharedRow;
    onOpen: (row: SharedRow) => void;
    /** The menu, the same as at the end of a table row. */
    actions: React.ReactNode;
}

/**
 * One shared backup as a card, the view a phone always gets: its database and when it was made,
 * who provides it, and its check, size and menu at the foot, like a card of the Backups tab.
 */
export function SharedCard({ row, onOpen, actions }: SharedCardProps) {
    const { database } = row;
    const former = isFormer(database);
    const made = madeAt(row);
    return (
        <div
            onClick={(event) => isPlainClick(event) && onOpen(row)}
            className="flex min-w-0 cursor-pointer flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground shadow-sm transition-colors hover:border-foreground/20 group-data-[state=open]/row:border-foreground/20"
        >
            <div className="flex items-start gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted/50" aria-hidden="true">
                    <AdapterIcon adapterId={database.adapterId} className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                    <button
                        type="button"
                        onClick={() => onOpen(row)}
                        className={cn(
                            "block max-w-full truncate rounded-sm text-left font-semibold outline-none hover:underline hover:underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring/50",
                            former && "text-muted-foreground"
                        )}
                    >
                        {database.databaseName}
                    </button>
                    <p className="truncate text-xs text-muted-foreground">
                        <DateDisplay date={row.createdAt} format="Pp" /> · <RelativeTime date={row.createdAt} />
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{made ? madeAtText(made, database.databaseName) : `on ${database.serverName}`}</p>
                </div>
                {former && <FormerTag label={formerLabel(database)} />}
            </div>

            <div><ProviderChip name={database.providerName} /></div>

            <div className="mt-auto flex min-w-0 items-center gap-3 border-t pt-3">
                <IntegrityBadge verification={checkOf(row)} />
                <BackupFlags file={{ locked: false, isEncrypted: row.encrypted }} />
                <span className="ml-auto shrink-0 text-sm font-medium tabular-nums">{row.dump ? formatBytes(row.dump.stored) : "-"}</span>
                <div className="-mr-2 shrink-0">{actions}</div>
            </div>
        </div>
    );
}
