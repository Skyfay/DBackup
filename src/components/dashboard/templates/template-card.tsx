"use client";

import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { isPlainClick } from "@/components/ui/row-click";
import { KindTile, type TemplateKind } from "./template-cells";

interface TemplateCardProps {
    kind: TemplateKind;
    name: string;
    sub: string;
    badges?: React.ReactNode;
    /** What the template does, in a line or two. */
    what: React.ReactNode;
    /** Who uses it. */
    usage: React.ReactNode;
    updatedAt: string;
    onOpen: () => void;
    actions: React.ReactNode;
}

/** A template on a phone: what it is, what it does and who uses it. */
export function TemplateCard({ kind, name, sub, badges, what, usage, updatedAt, onOpen, actions }: TemplateCardProps) {
    return (
        <div
            onClick={(event) => isPlainClick(event) && onOpen()}
            className="flex min-w-0 cursor-pointer flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground shadow-sm transition-colors hover:border-foreground/20 group-data-[state=open]/row:border-foreground/20"
        >
            <div className="flex items-start gap-3">
                <KindTile kind={kind} size="lg" />
                <div className="min-w-0 flex-1">
                    <button
                        type="button"
                        onClick={onOpen}
                        className="block max-w-full truncate rounded-sm text-left font-semibold outline-none hover:underline hover:underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring/50"
                    >
                        {name}
                    </button>
                    <p className="truncate text-xs text-muted-foreground">{sub}</p>
                </div>
                <div className="-mt-1 -mr-2">{actions}</div>
            </div>
            {badges && <div className="flex flex-wrap gap-1.5">{badges}</div>}
            <div className="min-w-0 text-sm">{what}</div>
            <div className="flex min-w-0 items-center gap-3 border-t pt-3">
                <div className="min-w-0 flex-1">{usage}</div>
                <span className="shrink-0 text-xs text-muted-foreground">
                    changed <RelativeTime date={updatedAt} />
                </span>
            </div>
        </div>
    );
}
