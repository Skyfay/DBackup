"use client";

import { useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Building2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useOpenInTenant, useTenantName, useTenantView } from "./tenant-view";

interface AllTenantsNoticeProps {
    /** The tenant of the record the page shows. Null while it loads, which shows nothing. */
    tenantId: string | null | undefined;
    /** The page that opens in that tenant. This page with its address when left out. */
    href?: string;
    className?: string;
}

/**
 * The note on the page of a record in All tenants, like one opened from a bookmark or a notification.
 * The page reads fine there, but it changes nothing, so the note offers to open it in its tenant.
 * Outside All tenants it shows nothing.
 */
export function AllTenantsNotice({ tenantId, href, className }: AllTenantsNoticeProps) {
    const { allTenants } = useTenantView();
    const nameOf = useTenantName();
    const openInTenant = useOpenInTenant();
    const pathname = usePathname();
    const query = useSearchParams().toString();
    const [opening, setOpening] = useState(false);

    if (!allTenants || !tenantId) return null;
    const name = nameOf(tenantId) ?? "its tenant";
    const target = href ?? `${pathname}${query ? `?${query}` : ""}`;

    const open = async () => {
        setOpening(true);
        try {
            await openInTenant(tenantId, target);
        } finally {
            setOpening(false);
        }
    };

    return (
        <div className={cn("relative overflow-hidden rounded-xl border bg-card p-4 pl-5 shadow-sm md:pl-6", className)} role="note">
            <span className="absolute inset-y-0 left-0 w-1 bg-muted-foreground/40" aria-hidden="true" />
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                        <Building2 className="size-5" aria-hidden="true" />
                    </div>
                    <div className="min-w-0 flex-1 space-y-0.5">
                        <p className="font-semibold leading-snug">You look at this in All tenants</p>
                        <p className="text-sm text-muted-foreground">Open it in {name} to change it.</p>
                    </div>
                </div>
                <Button variant="outline" size="sm" className="w-full shrink-0 sm:ml-auto sm:w-auto" onClick={() => void open()} disabled={opening}>
                    {opening ? <Loader2 className="animate-spin" /> : <Building2 />}
                    <span className="truncate">Open in {name}</span>
                </Button>
            </div>
        </div>
    );
}
