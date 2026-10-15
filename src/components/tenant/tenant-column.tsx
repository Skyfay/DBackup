"use client";

import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Building2 } from "lucide-react";
import type { DataTableFilterableColumn } from "@/components/ui/data-table-types";
import { cn } from "@/lib/utils";
import { compareTenantNames, matchesTenants, TENANT_COLUMN_ID, tenantFilterOptions } from "./tenant-rows";
import { useTenantName, useTenantView } from "./tenant-view";

/** The name of the tenant of a row, in a table cell. */
export function TenantCell({ name }: { name: string | null }) {
    return name
        ? <span className="block max-w-48 truncate text-sm" title={name}>{name}</span>
        : <span className="text-sm text-muted-foreground">-</span>;
}

/** The tenant of a record as a small line, like on a card or under a name in All tenants. */
export function TenantLine({ name, className }: { name: string | null; className?: string }) {
    if (!name) return null;
    return (
        <p className={cn("flex min-w-0 items-center gap-1 text-xs text-muted-foreground", className)}>
            <Building2 className="size-3 shrink-0" aria-hidden="true" />
            <span className="truncate">{name}</span>
        </p>
    );
}

interface TenantColumns<TData> {
    /** A platform admin looks at every tenant, the only time the column shows. */
    allTenants: boolean;
    /** The name of a tenant by its id. */
    nameOf: (tenantId: string | null | undefined) => string | null;
    /** The Tenant column, null outside All tenants. */
    column: ColumnDef<TData> | null;
    /** The Tenant filter, null outside All tenants. */
    filter: DataTableFilterableColumn<TData> | null;
}

/**
 * The Tenant column and filter of a list in All tenants, where it shows the rows of every tenant.
 * Anywhere else both are null and the list stays as it is.
 *
 * `rows` are the rows the filter offers the tenants of. A list the server pages passes none, so
 * the filter offers every tenant. `always` shows both in any view, for a list of the Platform,
 * which holds the rows of every tenant from inside a tenant too.
 */
export function useTenantColumns<TData>(tenantIdOf: (row: TData) => string | null | undefined, rows?: readonly TData[], options: { always?: boolean } = {}): TenantColumns<TData> {
    const { allTenants, tenants } = useTenantView();
    const nameOf = useTenantName();
    const shown = allTenants || options.always === true;

    const column = useMemo<ColumnDef<TData> | null>(() => {
        if (!shown) return null;
        return {
            id: TENANT_COLUMN_ID,
            accessorFn: (row) => tenantIdOf(row) ?? "",
            header: "Tenant",
            meta: { label: "Tenant" },
            enableSorting: true,
            sortingFn: (a, b, id) => compareTenantNames((tenantId) => nameOf(tenantId), a.getValue<string>(id), b.getValue<string>(id)),
            filterFn: (row, id, value: string[]) => matchesTenants(row.getValue<string>(id), value),
            cell: ({ row }) => <TenantCell name={nameOf(tenantIdOf(row.original))} />,
        };
    }, [shown, nameOf, tenantIdOf]);

    const filter = useMemo<DataTableFilterableColumn<TData> | null>(() => {
        if (!shown) return null;
        return {
            id: TENANT_COLUMN_ID,
            title: "Tenant",
            options: tenantFilterOptions(tenants, rows?.map(tenantIdOf)),
        };
    }, [shown, tenants, rows, tenantIdOf]);

    return useMemo(() => ({ allTenants, nameOf, column, filter }), [allTenants, nameOf, column, filter]);
}
