"use client";

import { useState } from "react";
import { AdapterIcon } from "@/components/adapter/adapter-icon";
import { cn, formatBytes } from "@/lib/utils";
import type { StorageVolumeEntry } from "@/services/dashboard-service";
import { RelativeTime } from "./relative-time";
import { StorageHistoryModal } from "./storage-history-modal";
import { useTenantName, useTenantView } from "@/components/tenant/tenant-view";
import { ListPager } from "./list-pager";

/** Ten rows end the card about where the activity panel beside it ends. */
const PAGE_SIZE = 10;

interface StorageDestinationsProps {
    entries: StorageVolumeEntry[];
    updatedAt: string | null;
    className?: string;
}

/** Size per destination with its share of the total. A click opens the usage history. */
export function StorageDestinations({ entries, updatedAt, className }: StorageDestinationsProps) {
    const [selected, setSelected] = useState<{ configId: string; name: string; adapterId: string } | null>(null);
    // In All tenants two destinations of different tenants can share a name, so each names its tenant.
    const { allTenants } = useTenantView();
    const tenantName = useTenantName();
    const total = entries.reduce((sum, entry) => sum + entry.size, 0);
    const sorted = [...entries].sort((a, b) => b.size - a.size);
    const [pageState, setPage] = useState(0);
    const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
    // A refresh can leave fewer destinations than the page that was open, so it stops at the last one.
    const page = Math.min(pageState, pageCount - 1);
    const visible = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    // With more than one page the last one keeps the height of a full page, so the card below does not jump.
    const fillers = pageCount > 1 ? PAGE_SIZE - visible.length : 0;

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
                <>
                    <ul className="mt-4 space-y-1">
                        {visible.map((entry) => {
                            const share = total > 0 ? (entry.size / total) * 100 : 0;
                            // A destination that was not reachable keeps the values of its last successful scan.
                            // Air-gapped targets are offline on purpose, so this only states the age, it does not warn.
                            // Connection problems are flagged once, by "Offline connections" in the stats strip.
                            const stale = entry.scanError === true;
                            const neverScanned = stale && !entry.lastScanAt;
                            const tenant = allTenants ? tenantName(entry.tenantId) : null;
                            return (
                                <li key={entry.configId ?? entry.name}>
                                    <button
                                        type="button"
                                        disabled={!entry.configId}
                                        onClick={() => entry.configId && setSelected({ configId: entry.configId, name: entry.name, adapterId: entry.adapterId })}
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
                                            className="mt-1 truncate text-xs text-muted-foreground"
                                            title={stale ? "Not reachable at the last refresh. The values are from its last successful scan." : undefined}
                                        >
                                            {tenant && <>{tenant} · </>}
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
                        {/* A filler is as tall as a row: 8px padding, the 20px name, the bar with its gap, the 16px line below and 8px padding. */}
                        {Array.from({ length: fillers }, (_, i) => (
                            <li key={`filler-${i}`} aria-hidden className="h-17.5" />
                        ))}
                    </ul>
                    {pageCount > 1 && (
                        <ListPager
                            page={page}
                            pageCount={pageCount}
                            pageSize={PAGE_SIZE}
                            total={sorted.length}
                            onPageChange={setPage}
                            label="Destination pages"
                        />
                    )}
                </>
            )}

            {selected && (
                <StorageHistoryModal
                    open
                    onOpenChange={(open) => !open && setSelected(null)}
                    configId={selected.configId}
                    adapterName={selected.name}
                    adapterId={selected.adapterId}
                />
            )}
        </div>
    );
}
