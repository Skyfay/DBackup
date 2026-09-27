"use client";

import { Archive, Clock, KeyRound, RotateCcw, ShieldCheck, UserRound } from "lucide-react";
import { AdapterIcon } from "@/components/adapter/adapter-icon";
import type { DataTableFilterableColumn } from "@/components/ui/data-table";
import type { RunPage, RunRow, RunStarterOption } from "@/services/history/run-types";
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

/**
 * The filters of the runs: the type, with the system tasks under a heading of their own, the job
 * and who started it. The numbers come from the server, which counts under the other filters.
 */
export function runFilters(page: RunPage | null): DataTableFilterableColumn<RunRow>[] {
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
            options: (page?.jobs ?? []).map((job) => ({
                value: job.id,
                label: job.name,
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
    ];
}
