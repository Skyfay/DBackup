"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Building2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
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

/** Takes the tenant off the address in the history of the browser, so the page stays as it is. Next.js follows it in useSearchParams. */
function dropTenant(): void {
    window.history.replaceState(null, "", address(true));
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
 *
 * A switch changes the tenant of every tab of the session, so a link the dashboard opened with asks
 * first: a mail, a chat, a bookmark or any other site, also through the login page, which follows
 * its `next` page within the browser. A link followed while the dashboard is open already is one of
 * DBackup's own and switches at once. Neither a marker in the address nor `document.referrer` tells
 * that apart, since any site can add the marker, and the referrer of the login page is DBackup.
 */
export function TenantFromLink() {
    const wanted = useSearchParams().get(TENANT_PARAM);
    const { tenants, allTenants, activeTenantId } = useTenantView();
    const mayOpen = useMayOpenTenant();
    const openInTenant = useOpenInTenant();
    const tried = useRef<string | null>(null);
    // The tenant of the address the dashboard opened with, which waits for an answer.
    const [asking, setAsking] = useState(wanted);

    useEffect(() => {
        if (!wanted) {
            tried.current = null;
            return;
        }
        if (linkTenantMove(wanted, { allTenants, activeTenantId }, mayOpen) === "drop") {
            // Answered as well, so a later link of the app to this tenant switches at once.
            setAsking(null);
            dropTenant();
            return;
        }
        // Switches once. A tenant that is gone or closed meanwhile says so, and the page stays where it is.
        if (tried.current === wanted || asking === wanted) return;
        tried.current = wanted;
        void openInTenant(wanted, address(false), { replace: true }).then((opened) => {
            if (!opened) dropTenant();
        });
    }, [wanted, asking, allTenants, activeTenantId, mayOpen, openInTenant]);

    const open = Boolean(wanted) && asking === wanted && linkTenantMove(wanted!, { allTenants, activeTenantId }, mayOpen) === "switch";
    const name = tenants.find((tenant) => tenant.id === wanted)?.name ?? "another tenant";
    const stay = () => {
        // Never switches for this link, also while the address still names it for a moment.
        tried.current = wanted;
        setAsking(null);
        dropTenant();
    };

    return (
        <ConfirmDialog
            open={open}
            onOpenChange={(next) => !next && stay()}
            tone="pick"
            icon={Building2}
            title={`Switch to ${name}?`}
            note="Every tab of this session follows"
            description={`This link opens ${name}. Switch to it?`}
            confirmLabel="Switch"
            cancelLabel="Stay"
            onConfirm={() => setAsking(null)}
        />
    );
}
