"use client";

import Link from "next/link";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { countLine, healthNote } from "@/components/layout/tenant-switch";
import { TenantTileMark } from "@/components/tenant/tenant-pick";
import { useOpenInTenant, useTenantView } from "@/components/tenant/tenant-view";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { TenantSummary } from "@/services/tenant/tenant-summaries";
import { tenantOverviewRows, tenantsLine } from "./tenants-model";

interface TenantsCardProps {
    summaries: TenantSummary[];
    className?: string;
}

/**
 * Every tenant with its jobs, its databases and how its newest backups went, for a platform admin in
 * All tenants. The ones that need a look come first, with the red and amber dot of the switcher, and
 * a click opens the Overview of that tenant.
 */
export function TenantsCard({ summaries, className }: TenantsCardProps) {
    const { tenants } = useTenantView();
    const openInTenant = useOpenInTenant();
    const [opening, setOpening] = useState<string | null>(null);
    const rows = tenantOverviewRows(tenants, summaries);

    const open = async (id: string) => {
        setOpening(id);
        try {
            await openInTenant(id, "/dashboard");
        } finally {
            setOpening(null);
        }
    };

    return (
        <div className={cn("min-w-0 rounded-xl border bg-card p-4 text-card-foreground shadow-sm md:p-5", className)}>
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <h2 className="font-semibold">Tenants</h2>
                    <p className="text-sm text-muted-foreground">{tenantsLine(rows)}</p>
                </div>
                <Button asChild variant="outline" size="sm" className="shrink-0">
                    <Link href="/dashboard/platform/tenants">Manage tenants</Link>
                </Button>
            </div>

            {rows.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No tenants yet.</p>
            ) : (
                <ScrollArea className="mt-3 -mx-2 *:data-[slot=scroll-area-viewport]:max-h-80">
                    <ul className="grid gap-x-4 gap-y-0.5 px-2 sm:grid-cols-2 xl:grid-cols-3">
                        {rows.map((row) => {
                            const note = healthNote(row.health);
                            return (
                                <li key={row.id} className="min-w-0">
                                    <button
                                        type="button"
                                        onClick={() => void open(row.id)}
                                        disabled={opening !== null}
                                        aria-label={`Open ${row.name}${note ? `. ${note}` : ""}`}
                                        className="flex w-full min-w-0 items-center gap-2.5 rounded-lg px-2 py-2 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-default"
                                    >
                                        <TenantTileMark name={row.name} />
                                        <span className="min-w-0 flex-1">
                                            <span className="block truncate text-sm font-medium">{row.name}</span>
                                            <span className="block truncate text-xs text-muted-foreground tabular-nums">{countLine(row)}</span>
                                        </span>
                                        {opening === row.id ? (
                                            <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
                                        ) : note ? (
                                            <span title={note} className={cn("size-2 shrink-0 rounded-full", row.health === "failed" ? "bg-destructive" : "bg-warning")} aria-hidden="true" />
                                        ) : null}
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                </ScrollArea>
            )}
        </div>
    );
}
