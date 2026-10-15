"use client";

import { Archive, Clock, KeyRound, RotateCcw, ShieldCheck, UserRound } from "lucide-react";
import { AdapterIcon } from "@/components/adapter/adapter-icon";
import type { DataTableFilterableColumn } from "@/components/ui/data-table";
import type { RunJobOption, RunPage, RunRow, RunStarterOption } from "@/services/history/run-types";
import { TYPE_GROUPS, TYPE_LABELS } from "./run-format";

const UNAVAILABLE = "No runs with the other filters";
const TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
    Backup: Archive,
    Restore: RotateCcw,
    IntegrityCheck: ShieldCheck,
    Verification: ShieldCheck,
    "System Restore": Archive,
};
const STARTER_ICONS: Record<RunStarterOption["group"], React.ComponentType<{ className?: string }> | null> = {
    System: Clock,
    "By hand": UserRound,
    "API keys": KeyRound,
    Other: null,
};

/** The Tenant filter of All tenants, and the names the jobs of the Job filter are grouped by there. */
export interface RunTenantFilter {
    filter: DataTableFilterableColumn<RunRow>;
    nameOf: (tenantId: string | null | undefined) => string | null;
}

/** The jobs of the Job filter, by tenant in All tenants, where two tenants may name a job alike. */
function jobOptions(jobs: RunJobOption[], tenant: RunTenantFilter | null) {
    const groupOf = (job: RunJobOption) => (tenant ? tenant.nameOf(job.tenantId) ?? job.tenantId : undefined);
    return tenant
        ? [...jobs].sort((a, b) => (groupOf(a) ?? "").localeCompare(groupOf(b) ?? "") || a.name.localeCompare(b.name)).map((job) => ({ job, group: groupOf(job) }))
        : jobs.map((job) => ({ job, group: undefined }));
}

/**
 * The filters of the runs: the type, with the system tasks under a heading of their own, the job
 * and who started it, and in All tenants the tenant. The numbers come from the server, which
 * counts under the other filters, the tenants included, since the list is paged there.
 */
export function runFilters(page: RunPage | null, tenant: RunTenantFilter | null = null): DataTableFilterableColumn<RunRow>[] {
    const facets = page?.facets;
    const shared = { note: "The numbers count the runs", unavailableLabel: UNAVAILABLE };
    const types = [...new Set([...Object.keys(TYPE_LABELS), ...Object.keys(facets?.type ?? {})])];
    return [
        {
            id: "type",
            title: "Type",
            ...shared,
            options: types.map((type) => {
                const Icon = TYPE_ICONS[type] ?? Archive;
                return {
                    value: type,
                    label: TYPE_LABELS[type] ?? type,
                    group: TYPE_GROUPS[type] ?? "System tasks",
                    lead: <Icon className="size-4 shrink-0 text-muted-foreground" />,
                    count: facets?.type[type] ?? 0,
                };
            }),
        },
        {
            id: "job",
            title: "Job",
            ...shared,
            options: jobOptions(page?.jobs ?? [], tenant).map(({ job, group }) => ({
                value: job.id,
                label: job.name,
                group,
                lead: job.adapterId ? <AdapterIcon adapterId={job.adapterId} className="size-4 shrink-0" /> : undefined,
                count: facets?.job[job.id] ?? 0,
            })),
        },
        {
            id: "by",
            title: "Started by",
            heading: "Filter by who started it",
            ...shared,
            options: (page?.starters ?? []).map((starter) => {
                const Icon = STARTER_ICONS[starter.group];
                return {
                    value: starter.value,
                    label: starter.label,
                    group: starter.group,
                    lead: Icon ? <Icon className="size-4 shrink-0 text-muted-foreground" /> : undefined,
                    count: facets?.starter[starter.value] ?? 0,
                };
            }),
        },
        ...(tenant
            ? [{
                ...tenant.filter,
                ...shared,
                options: tenant.filter.options.map((option) => ({ ...option, count: facets?.tenant?.[option.value] ?? 0 })),
            }]
            : []),
    ];
}
