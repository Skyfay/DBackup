"use client";

import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { TENANT_PARAM } from "@/lib/notifications/templates/format";
import { useMayOpenTenant, useOpenInTenant, useTenantView } from "./tenant-view";

/**
 * A link of a notification names the tenant of its record with `tenant=`, so a run or a job opens
 * from a mail while the session works in another tenant.
 */

/** What the dashboard does with the tenant a link names: switch into it, or only take it off the address. */
export type LinkTenantMove = "switch" | "drop";

/**
 * Switch while the viewer works in another tenant and may open the one named. All tenants reads
 * every tenant anyway, the open tenant needs nothing, and one the viewer may not open stays closed.
 */
export function linkTenantMove(
    wanted: string,
    view: { allTenants: boolean; activeTenantId: string | null },
    mayOpen: (tenantId: string) => boolean,
): LinkTenantMove {
    if (view.allTenants || wanted === view.activeTenantId || !mayOpen(wanted)) return "drop";
    return "switch";
}

/** The address as the browser shows it now, without the tenant it names when `withoutTenant`. */
function address(withoutTenant: boolean): string {
    const query = new URLSearchParams(window.location.search);
    if (withoutTenant) query.delete(TENANT_PARAM);
    const rest = query.toString();
    return `${window.location.pathname}${rest ? `?${rest}` : ""}${window.location.hash}`;
}

/**
 * Whether the address names a tenant the dashboard is about to switch into. A page waits with what
 * a link opens until the tenant shows, or it would look for the record in the wrong one.
 */
export function useSwitchFromLink(): boolean {
    const wanted = useSearchParams().get(TENANT_PARAM);
    const { allTenants, activeTenantId } = useTenantView();
    const mayOpen = useMayOpenTenant();
    return Boolean(wanted) && linkTenantMove(wanted!, { allTenants, activeTenantId }, mayOpen) === "switch";
}

/**
 * Follows the tenant a link names: switches the session into it and loads the same page there. The
 * parameter stays until the tenant shows, so the page keeps waiting meanwhile, and then goes. A
 * tenant the viewer may not open, or the one open already, only loses the parameter. Mounted once,
 * by the dashboard layout.
 */
export function TenantFromLink() {
    const wanted = useSearchParams().get(TENANT_PARAM);
    const { allTenants, activeTenantId } = useTenantView();
    const mayOpen = useMayOpenTenant();
    const openInTenant = useOpenInTenant();
    const tried = useRef<string | null>(null);

    useEffect(() => {
        if (!wanted) {
            tried.current = null;
            return;
        }
        // The history of the browser, so the page stays as it is. Next.js follows it in useSearchParams.
        const drop = () => window.history.replaceState(null, "", address(true));
        if (linkTenantMove(wanted, { allTenants, activeTenantId }, mayOpen) === "drop") {
            drop();
            return;
        }
        // Switches once. A tenant that is gone or closed meanwhile says so, and the page stays where it is.
        if (tried.current === wanted) return;
        tried.current = wanted;
        void openInTenant(wanted, address(false), { replace: true }).then((opened) => {
            if (!opened) drop();
        });
    }, [wanted, allTenants, activeTenantId, mayOpen, openInTenant]);

    return null;
}
