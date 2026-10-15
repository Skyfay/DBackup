"use client";

import { useCallback, useState } from "react";
import { TenantPickDialog } from "./tenant-pick";
import { useOpenInTenant, useTenantView } from "./tenant-view";

/**
 * Opens a record of a list. In All tenants the record opens in its tenant at `href`, where it can
 * be changed, anywhere else `here` opens it in place, like its side panel.
 */
export function useOpenRecord(): (tenantId: string | null | undefined, href: string, here: () => void) => void {
    const { allTenants } = useTenantView();
    const openInTenant = useOpenInTenant();
    return useCallback((tenantId, href, here) => {
        if (allTenants && tenantId) void openInTenant(tenantId, href);
        else here();
    }, [allTenants, openInTenant]);
}

interface NewInTenantOptions {
    /** Whether the viewer may add the record here. All tenants offers it to every platform admin. */
    canCreate: boolean;
    /** What the pick is for, like "New job". */
    title: string;
    /** Why it asks, like "A job belongs to one tenant, pick the one it runs in." */
    description: string;
    /** The form of a new record, which opens in the picked tenant. */
    href: string;
    /** Opens the form here, outside All tenants. */
    onCreate: () => void;
}

interface NewInTenant {
    /** Whether a New button shows at all. */
    available: boolean;
    /** What the New button does: the form here, or the pick of the tenant in All tenants. */
    start: () => void;
    /** The pick of the tenant, mounted beside the button. Null outside All tenants. */
    dialog: React.ReactNode;
}

/**
 * The New button of a list. A record belongs to one tenant, so in All tenants it first asks which
 * one and opens the form of a new record there, where the platform admin may add it.
 */
export function useNewInTenant({ canCreate, title, description, href, onCreate }: NewInTenantOptions): NewInTenant {
    const { allTenants } = useTenantView();
    const [picking, setPicking] = useState(false);
    const start = useCallback(() => {
        if (allTenants) setPicking(true);
        else onCreate();
    }, [allTenants, onCreate]);

    return {
        available: allTenants || canCreate,
        start,
        dialog: allTenants
            ? <TenantPickDialog open={picking} onOpenChange={setPicking} title={title} description={description} href={href} />
            : null,
    };
}
