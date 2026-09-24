import { cn } from "@/lib/utils";

export interface StripCell {
    label: string;
    value: React.ReactNode;
    /** Split off the value in muted text, like "GB" or "ago". */
    unit?: string;
    extra?: React.ReactNode;
    tone?: "warning" | "destructive";
}

/**
 * The headline numbers of a job or a destination, in the strip style of the dashboard. Five cells
 * sit in one row from md up, on a phone the last one takes the whole second row.
 */
export function ExplorerStrip({ cells }: { cells: StripCell[] }) {
    return (
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border shadow-sm md:grid-cols-5 [&>*:last-child:nth-child(odd)]:col-span-2 md:[&>*:last-child:nth-child(odd)]:col-span-1">
            {cells.map((cell) => (
                <div key={cell.label} className="min-w-0 bg-card px-4 py-3">
                    <div className="truncate text-xs text-muted-foreground">{cell.label}</div>
                    <div className="mt-1 flex items-baseline gap-1.5">
                        <span
                            className={cn(
                                "text-lg font-semibold tracking-tight tabular-nums",
                                cell.tone === "warning" && "text-warning",
                                cell.tone === "destructive" && "text-destructive"
                            )}
                        >
                            {cell.value}
                        </span>
                        {cell.unit && <span className="truncate text-xs text-muted-foreground tabular-nums">{cell.unit}</span>}
                    </div>
                    {cell.extra && <div className="truncate text-xs text-muted-foreground">{cell.extra}</div>}
                </div>
            ))}
        </div>
    );
}
