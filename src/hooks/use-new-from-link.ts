"use client";

import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { useTenantView } from "@/components/tenant/tenant-view";

/** The address parameter that opens the form of a new record, like `/dashboard/jobs?new=1`. */
export const NEW_PARAM = "new";

/**
 * Opens the form of a new record when the address asks for it with `?new=1`, like the pick of a
 * tenant in All tenants does after it switched there. Once `ready`, it opens the form once and takes
 * the parameter off the address, so a reload does not open it again.
 *
 * A form opens only inside a tenant. The pick leads to the address and then loads the page in the
 * new tenant, and the page of All tenants it leaves may get the rights of that tenant first. A form
 * opened there would close with that page and take the parameter along, so it waits for the page
 * of the tenant, which mounts anew.
 */
export function useNewFromLink(ready: boolean, open: () => void) {
    const wanted = useSearchParams().get(NEW_PARAM) !== null;
    const { allTenants } = useTenantView();
    const openRef = useRef(open);
    const handled = useRef(false);

    useEffect(() => {
        openRef.current = open;
    });

    useEffect(() => {
        if (!wanted) {
            handled.current = false;
            return;
        }
        if (!ready || allTenants || handled.current) return;
        handled.current = true;
        openRef.current();
        // The history of the browser, so the page stays as it is. Next.js follows it in useSearchParams.
        const rest = new URLSearchParams(window.location.search);
        rest.delete(NEW_PARAM);
        const query = rest.toString();
        window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
    }, [wanted, ready, allTenants]);
}
