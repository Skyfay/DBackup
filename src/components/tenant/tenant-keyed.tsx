"use client";

import { Fragment } from "react";
import { useTenantView } from "./tenant-view";

/**
 * Mounts its children again when the tenant changes. A list loads its rows in the browser, so after
 * opening a record in its tenant from All tenants, on the same page, it would keep the rows of every
 * tenant until its next poll. Keyed by the tenant, it loads the rows of the new one at once.
 */
export function TenantKeyed({ children }: { children: React.ReactNode }) {
    const { activeTenantId, allTenants } = useTenantView();
    return <Fragment key={allTenants ? "*" : activeTenantId ?? "none"}>{children}</Fragment>;
}
