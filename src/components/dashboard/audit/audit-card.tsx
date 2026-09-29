"use client";

import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { isPlainClick } from "@/components/ui/row-click";
import { cn } from "@/lib/utils";
import type { AuditRow } from "@/services/audit/audit-types";
import { ActorFace, DeletedTag, EntryIcon, NewPlaceBadge, Sentence } from "./audit-cells";

/** An entry as a card for a phone: the sentence, what changed, and who, where and when. */
export function AuditCard({ row, onOpen }: { row: AuditRow; onOpen: (row: AuditRow) => void }) {
    return (
        <div
            onClick={(event) => isPlainClick(event) && onOpen(row)}
            className="flex min-w-0 cursor-pointer flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground shadow-sm transition-colors hover:border-foreground/20"
        >
            <button type="button" onClick={() => onOpen(row)} className="flex min-w-0 items-start gap-2.5 rounded-sm text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
                <EntryIcon glyph={row.glyph} kind={row.kind} className="mt-0.5" />
                <span className="min-w-0">
                    <Sentence parts={row.parts} className={cn("line-clamp-2", row.kind === "failed" && "text-warning")} />
                    {row.summary && <span className="mt-0.5 block truncate text-xs text-muted-foreground">{row.summary}</span>}
                </span>
            </button>
            {row.newPlace && <NewPlaceBadge />}
            <div className="flex min-w-0 items-center gap-2.5 border-t pt-3">
                <ActorFace actor={row.actor} />
                <span className="flex min-w-0 flex-1 items-center gap-1.5 text-sm">
                    <span className="truncate">{row.actor.name}</span>
                    {row.actor.deleted && <DeletedTag />}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                    {row.area && `${row.area} · `}
                    <RelativeTime date={row.at} />
                </span>
            </div>
        </div>
    );
}
