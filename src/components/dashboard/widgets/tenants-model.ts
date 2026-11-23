import type { TenantHealth, TenantSummary } from "@/services/tenant/tenant-summaries";

/**
 * The card Tenants of the Overview in All tenants as plain functions: which tenant comes first and
 * what its head says.
 */

/** A tenant as the card lists it. */
export interface TenantOverviewRow {
    id: string;
    name: string;
    jobs: number;
    databases: number;
    /** The databases of other tenants it holds now. */
    shared: number;
    health: TenantHealth;
}

const HEALTH_ORDER: Record<"failed" | "partial" | "fine", number> = { failed: 0, partial: 1, fine: 2 };

/**
 * Every tenant with its numbers, the ones whose newest backup of a job failed first, then those that
 * missed a copy, then the rest, each by name. A tenant without a summary yet counts nothing.
 */
export function tenantOverviewRows(tenants: readonly { id: string; name: string }[], summaries: readonly TenantSummary[]): TenantOverviewRow[] {
    const byId = new Map(summaries.map((summary) => [summary.id, summary]));
    return tenants
        .map((tenant) => {
            const summary = byId.get(tenant.id);
            return { id: tenant.id, name: tenant.name, jobs: summary?.jobs ?? 0, databases: summary?.databases ?? 0, shared: summary?.shared ?? 0, health: summary?.health ?? null };
        })
        .sort((a, b) => HEALTH_ORDER[a.health ?? "fine"] - HEALTH_ORDER[b.health ?? "fine"] || a.name.localeCompare(b.name));
}

/** "14 tenants · 2 need a look", the line under the title of the card. */
export function tenantsLine(rows: readonly TenantOverviewRow[]): string {
    const count = `${rows.length.toLocaleString("en-US")} tenant${rows.length === 1 ? "" : "s"}`;
    const troubled = rows.filter((row) => row.health !== null).length;
    if (rows.length === 0) return count;
    if (troubled === 0) return `${count} · all backups healthy`;
    return `${count} · ${troubled.toLocaleString("en-US")} need${troubled === 1 ? "s" : ""} a look`;
}
