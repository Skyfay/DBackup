"use client";

import { createContext, useCallback, useContext, useMemo } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { switchTenant } from "@/app/actions/tenant/tenant";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { announceTenantSwitch } from "./tenant-sync";
import type { AllowanceKind, TenantAllowances } from "@/lib/tenant/allowances";

const log = logger.child({ component: "tenant-view" });

export interface ViewTenant {
    id: string;
    name: string;
    /** Where its logo is served, null without one, which shows its initials instead. */
    logo?: string | null;
    /** A tenant of the MSP that shares databases, destinations and channels with customers. */
    sharesWithCustomers?: boolean;
    /** What it may add itself, which the platform decides. Everything when left out. */
    allowances?: TenantAllowances;
    /**
     * What the viewer may change there, like `jobs:write`, which the New buttons of All tenants
     * offer by. Left out for a platform admin, who may change everything everywhere.
     */
    writes?: readonly string[];
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
    /** The name of the home tenant, the platform, which decides what a tenant adds itself. */
    platformName?: string;
    /** Whether the sidebar offers Quick Setup, which the search of pages follows. */
    showQuickSetup?: boolean;
    /** Whether the open tenant has or may add a database connection, which the Database Explorer needs. */
    ownDatabases?: boolean;
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
 * Whether the open tenant may add connections of a kind itself, which the platform decides. Always
 * in All tenants, where New asks for a tenant that may, and outside the dashboard.
 */
export function useMayAdd(kind: AllowanceKind): boolean {
    const { tenants, activeTenantId } = useTenantView();
    return tenants.find((tenant) => tenant.id === activeTenantId)?.allowances?.[kind] !== false;
}

const NO_NAMES: readonly { id: string; name: string }[] = [];
const TenantNamesContext = createContext<readonly { id: string; name: string }[]>(NO_NAMES);

/**
 * The names of tenants the viewer may see but not open, for a page that lists the records of
 * every tenant, like Users & Groups of the Platform for someone of a platform group of some
 * tenants. The tenant view names only the tenants the viewer may open.
 */
export function TenantNamesProvider({ names, children }: { names: readonly { id: string; name: string }[]; children: React.ReactNode }) {
    return <TenantNamesContext.Provider value={names}>{children}</TenantNamesContext.Provider>;
}

/** Every tenant the page knows by name: the ones the viewer may open, then the others it was given. */
export function useNamedTenants(): readonly { id: string; name: string }[] {
    const { tenants } = useTenantView();
    const names = useContext(TenantNamesContext);
    return useMemo(() => {
        if (names.length === 0) return tenants;
        const open = new Set(tenants.map((tenant) => tenant.id));
        return [...tenants, ...names.filter((tenant) => !open.has(tenant.id))];
    }, [tenants, names]);
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
    const named = useNamedTenants();
    const names = useMemo(() => new Map(named.map((tenant) => [tenant.id, tenant.name])), [named]);
    return useCallback((tenantId) => (tenantId ? names.get(tenantId) ?? null : null), [names]);
}

/** Whether the viewer may open a tenant: a platform admin every one, anyone else the tenants of the view. */
export function useMayOpenTenant(): (tenantId: string | null | undefined) => boolean {
    const { tenants, isPlatformAdmin } = useTenantView();
    const open = useMemo(() => new Set(tenants.map((tenant) => tenant.id)), [tenants]);
    return useCallback((tenantId) => Boolean(tenantId) && (isPlatformAdmin || open.has(tenantId as string)), [isPlatformAdmin, open]);
}

/**
 * Opens a page in the tenant of the record it shows. In All tenants the session first switches into
 * that tenant, since a change of a record happens in its tenant, then the page opens, says where
 * and tells the other tabs. Anywhere else it is a plain navigation. A tenant that is gone or closed
 * meanwhile says so and loads the tenants again. `replace` takes the place of the address in the
 * history of the browser, for a link that only switches the tenant of the page it opened.
 */
export function useOpenInTenant(): (tenantId: string, href: string, options?: { replace?: boolean }) => Promise<boolean> {
    const router = useRouter();
    const { allTenants, activeTenantId } = useTenantView();
    return useCallback(async (tenantId: string, href: string, options?: { replace?: boolean }) => {
        const go = (target: string) => (options?.replace ? router.replace(target) : router.push(target));
        if (!allTenants && tenantId === activeTenantId) {
            go(href);
            return true;
        }
        try {
            const result = await switchTenant(tenantId);
            if (!result.success) {
                toast.error(result.error);
                // The tenants of the head and of every pick come from the layout, which reads them again.
                router.refresh();
                return false;
            }
            toast.success(`You work in ${result.data.name} now`);
            announceTenantSwitch(tenantId, result.data.name);
            go(href);
            router.refresh();
            return true;
        } catch (error: unknown) {
            log.warn("Opening a page in its tenant failed", { tenantId }, wrapError(error));
            toast.error("The tenant could not be opened.");
            return false;
        }
    }, [router, allTenants, activeTenantId]);
}
