"use client";

import { createContext, useCallback, useContext, useMemo } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { switchTenant } from "@/app/actions/tenant/tenant";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";

const log = logger.child({ component: "tenant-view" });

export interface ViewTenant {
    id: string;
    name: string;
    /** Where its logo is served, null without one, which shows its initials instead. */
    logo?: string | null;
}

/** Which tenant the dashboard shows, as the layout resolved it on the server. */
export interface TenantView {
    /** The tenants the viewer may open, the home tenant first. Every tenant for a platform admin. */
    tenants: ViewTenant[];
    /** The tenant the viewer works in, null in All tenants. */
    activeTenantId: string | null;
    /**
     * A platform admin looks at every tenant at once. Lists show the rows of every tenant with
     * their tenant, and a change happens in the tenant of the record, see `useOpenInTenant`.
     */
    allTenants: boolean;
    isPlatformAdmin: boolean;
    /** How many tenants the instance has, also the ones the viewer may not open. As many as `tenants` when left out. */
    tenantCount?: number;
}

const OUTSIDE: TenantView = { tenants: [], activeTenantId: null, allTenants: false, isPlatformAdmin: false, tenantCount: 1 };

const TenantViewContext = createContext<TenantView | null>(null);

export function TenantViewProvider({ value, children }: { value: TenantView; children: React.ReactNode }) {
    return <TenantViewContext.Provider value={value}>{children}</TenantViewContext.Provider>;
}

/** The tenant view of the dashboard. Outside it, like in a test, one tenant and not All tenants. */
export function useTenantView(): TenantView {
    return useContext(TenantViewContext) ?? OUTSIDE;
}

/**
 * Whether the instance has more than one tenant, which brings the tenant settings and the section
 * Platform. Every install before tenants has one.
 */
export function useSeveralTenants(): boolean {
    const { tenants, tenantCount } = useTenantView();
    return (tenantCount ?? tenants.length) > 1;
}

/** The name of a tenant by its id, for the Tenant column of a list in All tenants. */
export function useTenantName(): (tenantId: string | null | undefined) => string | null {
    const { tenants } = useTenantView();
    const names = useMemo(() => new Map(tenants.map((tenant) => [tenant.id, tenant.name])), [tenants]);
    return useCallback((tenantId) => (tenantId ? names.get(tenantId) ?? null : null), [names]);
}

/**
 * Opens a page in the tenant of the record it shows. In All tenants the session first switches into
 * that tenant, since a change of a record happens in its tenant, then the page opens and says
 * where. Anywhere else it is a plain navigation.
 */
export function useOpenInTenant(): (tenantId: string, href: string) => Promise<boolean> {
    const router = useRouter();
    const { allTenants, activeTenantId } = useTenantView();
    return useCallback(async (tenantId: string, href: string) => {
        if (!allTenants && tenantId === activeTenantId) {
            router.push(href);
            return true;
        }
        try {
            const result = await switchTenant(tenantId);
            if (!result.success) {
                toast.error(result.error);
                return false;
            }
            toast.success(`You work in ${result.data.name} now`);
            router.push(href);
            router.refresh();
            return true;
        } catch (error: unknown) {
            log.warn("Opening a page in its tenant failed", { tenantId }, wrapError(error));
            toast.error("The tenant could not be opened.");
            return false;
        }
    }, [router, allTenants, activeTenantId]);
}
