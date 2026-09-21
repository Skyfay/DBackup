"use client";

import { useState } from "react";
import { AdapterIcon } from "@/components/adapter/adapter-icon";
import { cn, formatBytes } from "@/lib/utils";
import type { StorageVolumeEntry } from "@/services/dashboard-service";
import { RelativeTime } from "./relative-time";
import { StorageHistoryModal } from "./storage-history-modal";

interface StorageDestinationsProps {
    entries: StorageVolumeEntry[];
    updatedAt: string | null;
    className?: string;
}

/** Size per destination with its share of the total. A click opens the usage history. */
export function StorageDestinations({ entries, updatedAt, className }: StorageDestinationsProps) {
    const [selected, setSelected] = useState<{ configId: string; name: string } | null>(null);
    const total = entries.reduce((sum, entry) => sum + entry.size, 0);
    const sorted = [...entries].sort((a, b) => b.size - a.size);

    return (
        <div className={cn("min-w-0 rounded-xl border bg-card p-4 text-card-foreground shadow-sm md:p-5", className)}>
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h2 className="font-semibold">Storage by destination</h2>
                    <p className="text-sm text-muted-foreground">
                        {formatBytes(total, 1)} in {entries.length} destination{entries.length === 1 ? "" : "s"}
                    </p>
                </div>
                {updatedAt && (
                    <span className="shrink-0 pt-0.5 text-xs text-muted-foreground" title="Refreshed hourly by a system task and after every backup">
                        <RelativeTime date={updatedAt} />
                    </span>
                )}
            </div>

            {sorted.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No destinations configured.</p>
            ) : (
                <ul className="mt-4 space-y-1">
                    {sorted.map((entry) => {
                        const share = total > 0 ? (entry.size / total) * 100 : 0;
                        // A destination that was not reachable keeps the values of its last successful scan.
                        // Air-gapped targets are offline on purpose, so this only states the age, it does not warn.
                        // Connection problems are flagged once, by "Offline connections" in the stats strip.
                        const stale = entry.scanError === true;
                        const neverScanned = stale && !entry.lastScanAt;
                        return (
                            <li key={entry.configId ?? entry.name}>
                                <button
                                    type="button"
                                    disabled={!entry.configId}
                                    onClick={() => entry.configId && setSelected({ configId: entry.configId, name: entry.name })}
                                    className="-mx-2 w-[calc(100%+1rem)] rounded-md px-2 py-2 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 disabled:cursor-default disabled:hover:bg-transparent"
                                >
                                    <div className="flex items-center justify-between gap-3">
                                        <span className="flex min-w-0 items-center gap-2">
                                            <AdapterIcon adapterId={entry.adapterId} className="size-4 shrink-0" />
                                            <span className="truncate text-sm font-medium">{entry.name}</span>
                                        </span>
                                        <span className={cn("shrink-0 text-sm tabular-nums", neverScanned && "text-muted-foreground")}>
                                            {neverScanned ? "-" : formatBytes(entry.size, 1)}
                                        </span>
                                    </div>
                                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                                        {/* Width is the computed share, the one value here that cannot be a class. */}
                                        <div className="h-full rounded-full bg-foreground/80" style={{ width: `${Math.max(share, share > 0 ? 1 : 0)}%` }} />
                                    </div>
                                    <div
                                        className="mt-1 text-xs text-muted-foreground"
                                        title={stale ? "Not reachable at the last refresh. The values are from its last successful scan." : undefined}
                                    >
                                        {neverScanned ? (
                                            "Not scanned yet"
                                        ) : (
                                            <>
                                                {entry.count.toLocaleString("en-US")} backup{entry.count === 1 ? "" : "s"}
                                                {stale && <> · last scanned <RelativeTime date={entry.lastScanAt!} /></>}
                                            </>
                                        )}
                                    </div>
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}

            {selected && (
                <StorageHistoryModal
                    open
                    onOpenChange={(open) => !open && setSelected(null)}
                    configId={selected.configId}
                    adapterName={selected.name}
                />
            )}
        </div>
    );
}
