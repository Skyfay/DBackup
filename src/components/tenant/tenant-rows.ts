import type { ColumnDef } from "@tanstack/react-table";
import type { DataTableFilterOption } from "@/components/ui/data-table-types";

/**
 * The rules of the Tenant column and the Tenant filter of a list in All tenants, as plain functions,
 * so a list and a test read them alike.
 */

/** The id of the Tenant column, which its filter names too. */
export const TENANT_COLUMN_ID = "tenant";

/** A tenant as the lists name it. */
export interface NamedTenant {
    id: string;
    name: string;
}

/**
 * The options of the Tenant filter: every tenant that holds a row, by name. Without rows, like for a
 * list the server pages, every tenant. A tenant the viewer does not know by name keeps its id, so
 * its rows can still be filtered.
 */
export function tenantFilterOptions(tenants: readonly NamedTenant[], rowTenantIds?: Iterable<string | null | undefined>): DataTableFilterOption[] {
    const names = new Map(tenants.map((tenant) => [tenant.id, tenant.name]));
    const ids = rowTenantIds === undefined
        ? tenants.map((tenant) => tenant.id)
        : [...new Set([...rowTenantIds].filter((id): id is string => typeof id === "string" && id.length > 0))];
    return ids
        .map((id) => ({ value: id, label: names.get(id) ?? id }))
        .sort((a, b) => a.label.localeCompare(b.label));
}

/** The Tenant filter of a list the server pages, with how many rows of each tenant the server counted. */
export function withTenantCounts<T extends { options: DataTableFilterOption[] }>(filter: T, counts: Record<string, number> | undefined): T {
    return { ...filter, options: filter.options.map((option) => ({ ...option, count: counts?.[option.value] ?? 0 })) };
}

/** Whether a row passes the picked tenants of the filter. Nothing picked lets every row pass. */
export function matchesTenants(tenantId: string | null | undefined, picked: readonly string[] | undefined): boolean {
    if (!picked || picked.length === 0) return true;
    return typeof tenantId === "string" && picked.includes(tenantId);
}

/**
 * The columns of a list with the Tenant column right after the ones pinned to the start, or after
 * the first column when none is pinned, so the tenant reads next to the name. Without a Tenant
 * column the list stays as it is.
 */
export function withTenantColumn<TData, TValue>(columns: ColumnDef<TData, TValue>[], tenant: ColumnDef<TData, TValue> | null): ColumnDef<TData, TValue>[] {
    if (!tenant) return columns;
    let at = 0;
    columns.forEach((column, index) => {
        if (column.meta?.pin === "start") at = index + 1;
    });
    if (at === 0) at = Math.min(1, columns.length);
    return [...columns.slice(0, at), tenant, ...columns.slice(at)];
}

/** Sorts tenant ids by the names they show, those without a name last. */
export function compareTenantNames(nameOf: (tenantId: string) => string | null, a: string, b: string): number {
    const left = nameOf(a);
    const right = nameOf(b);
    if (left === null || right === null) return left === right ? 0 : left === null ? 1 : -1;
    return left.localeCompare(right);
}
