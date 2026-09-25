"use client";

import { kindNames } from "@/components/adapter/connection-columns";
import { signedBytes } from "@/components/dashboard/widgets/storage-history-data";
import { isPlainClick } from "@/components/ui/row-click";
import { cn, formatBytes } from "@/lib/utils";
import type { ExplorerDestination, ExplorerJob } from "@/services/storage/explorer-types";
import { activeAlerts, jobsOfDestination, limitShare } from "./destination-model";
import { AnswerText, DestinationTile } from "./explorer-cells";
import { count } from "./explorer-format";

interface DestinationCardProps {
    destination: ExplorerDestination;
    jobs: ExplorerJob[];
    /** Whether its details show under the list. */
    picked: boolean;
    onPick: (destination: ExplorerDestination) => void;
    /** The menu, the same as at the end of a table row. */
    actions: React.ReactNode;
}

/**
 * One destination as a card, the view a phone gets: whether it answers, what it stores and how
 * that changed, and its alerts. A tap shows its details under the list.
 */
export function DestinationCard({ destination, jobs, picked, onPick, actions }: DestinationCardProps) {
    const share = limitShare(destination);
    const alerts = activeAlerts(destination);
    const jobCount = jobsOfDestination(destination.id, jobs).length;
    return (
        <div
            onClick={(event) => isPlainClick(event) && onPick(destination)}
            data-active={picked ? "true" : undefined}
            className="flex min-w-0 cursor-pointer flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground shadow-sm transition-colors hover:border-foreground/20 data-[active=true]:border-foreground/40 group-data-[state=open]/row:border-foreground/20"
        >
            <div className="flex items-start gap-3">
                <DestinationTile destination={destination} />
                <div className="min-w-0 flex-1">
                    <button
                        type="button"
                        onClick={() => onPick(destination)}
                        className="block max-w-full truncate rounded-sm text-left font-semibold outline-none hover:underline hover:underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring/50"
                    >
                        {destination.name}
                    </button>
                    <p className="truncate text-xs text-muted-foreground">
                        {kindNames.get(destination.adapterId) ?? destination.adapterId} · {count(jobCount, "job")}
                    </p>
                </div>
                <AnswerText destination={destination} className="shrink-0" />
            </div>

            {alerts.length > 0 && (
                <p className={cn("truncate text-xs font-medium", destination.alerts.missingBackup.active ? "text-destructive" : "text-warning")}>
                    {alerts.join(", ")}
                </p>
            )}

            <div className="mt-auto flex min-w-0 items-center gap-3 border-t pt-3 text-sm tabular-nums">
                <span className="font-medium">{formatBytes(destination.size)}</span>
                <span className="truncate text-xs text-muted-foreground">
                    {share !== null ? `${Math.round(share * 100)} % of the limit` : `${destination.count.toLocaleString()} backups`}
                    {destination.growth !== null && destination.growth !== 0 && <> · {signedBytes(destination.growth)} in 7 days</>}
                </span>
                <div className="-mr-2 ml-auto shrink-0">{actions}</div>
            </div>
        </div>
    );
}
