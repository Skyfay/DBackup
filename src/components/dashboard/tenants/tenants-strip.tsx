"use client";

import { Building2, CalendarClock, Database, TriangleAlert, Users } from "lucide-react";
import { ExplorerStrip } from "@/components/dashboard/storage/explorer/explorer-strip";
import { namesFor } from "@/lib/core/tab-attention";
import { troubledTenants, type TenantListRow } from "./tenant-words";

const sum = (rows: readonly TenantListRow[], pick: (row: TenantListRow) => number) => rows.reduce((total, row) => total + pick(row), 0);

/**
 * The numbers above the tenants: how many there are, their memberships, their databases and jobs,
 * and the tenants whose newest backup of a job failed or missed a copy. Worked out from the list.
 */
export function TenantsStrip({ rows }: { rows: readonly TenantListRow[] }) {
    const customers = rows.filter((row) => !row.isHome).length;
    const { failed, partial } = troubledTenants(rows);
    const attention = [
        ...(failed.length > 0 ? [`${namesFor(failed)} had a backup fail`] : []),
        ...(partial.length > 0 ? [`${namesFor(partial)} missed a copy`] : []),
    ];

    return (
        <ExplorerStrip
            joined
            cells={[
                {
                    label: "Tenants",
                    icon: Building2,
                    value: rows.length.toLocaleString(),
                    extra: `the home tenant and ${customers.toLocaleString()} ${customers === 1 ? "customer" : "customers"}`,
                },
                {
                    label: "Memberships",
                    icon: Users,
                    value: sum(rows, (row) => row.members).toLocaleString(),
                    extra: "an account in several tenants counts in each, platform admins only where they are members",
                },
                {
                    label: "Databases",
                    icon: Database,
                    value: sum(rows, (row) => row.databases).toLocaleString(),
                    extra: `on ${sum(rows, (row) => row.connections).toLocaleString()} connections, as their servers listed them last`,
                },
                {
                    label: "Jobs",
                    icon: CalendarClock,
                    value: sum(rows, (row) => row.jobs).toLocaleString(),
                },
                {
                    label: "Need a look",
                    icon: TriangleAlert,
                    value: (failed.length + partial.length).toLocaleString(),
                    tone: failed.length > 0 ? "destructive" : partial.length > 0 ? "warning" : undefined,
                    extra: attention.length > 0 ? attention.join(", ") : "the newest backup of every job went through",
                },
            ]}
        />
    );
}
