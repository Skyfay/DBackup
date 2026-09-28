"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { AdapterIcon } from "@/components/adapter/adapter-icon";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { describeConfig, RETENTION_MODES, RETENTION_TIERS } from "@/components/templates/retention-words";
import type { DataTableFilterableColumn } from "@/components/ui/data-table";
import { DateDisplay } from "@/components/utils/date-display";
import type { RetentionConfiguration, RetentionMode } from "@/lib/core/retention";
import type { RetentionRow } from "@/services/templates/templates-types";
import { BuiltInBadge, DefaultBadge, DestinationStack, NameCell } from "./template-cells";
import { count } from "./template-format";

/** The shades of the tiers, the finest darkest. Neutral, since a tier is no status. */
const SHADES = ["bg-foreground/70", "bg-foreground/55", "bg-foreground/40", "bg-foreground/25", "bg-foreground/15"];

/** The tiers of a smart policy as parts of one bar, each as long as it keeps backups. */
export function TierBar({ config, className }: { config: RetentionConfiguration; className?: string }) {
    const smart = config.mode === "SMART" ? config.smart : undefined;
    if (!smart) return null;
    const tiers = RETENTION_TIERS.map((tier, index) => ({ key: tier.key, count: smart[tier.key] ?? 0, shade: SHADES[index] })).filter((tier) => tier.count > 0);
    const total = tiers.reduce((sum, tier) => sum + tier.count, 0);
    if (total === 0) return null;
    return (
        <div className={className ?? "mt-1.5 flex h-1.5 w-36 gap-0.5 overflow-hidden rounded-full"} aria-hidden="true">
            {tiers.map((tier) => (
                // The width is the share itself, the one value no class can hold.
                <span key={tier.key} className={tier.shade} style={{ width: `${(tier.count / total) * 100}%` }} />
            ))}
        </div>
    );
}

/** The destinations a policy reaches, and in how many jobs. */
export function reachOf(row: RetentionRow): string {
    const jobs = new Set(row.uses.map((use) => use.jobId)).size;
    return `${count(row.uses.length, "destination")} in ${count(jobs, "job")}`;
}

/** "Smart rotation · For copies that leave the house". */
export function policySub(row: RetentionRow): string {
    return [RETENTION_MODES[row.config.mode], row.description].filter(Boolean).join(" · ");
}

const destinationsOf = (row: RetentionRow) => [...new Set(row.uses.map((use) => use.destinationId))];

interface ColumnOptions {
    onOpen: (row: RetentionRow) => void;
    renderActions: (row: RetentionRow) => React.ReactNode;
}

/** The columns of the retention policies. Name and actions stay put, the rest can move and hide. */
export function retentionColumns({ onOpen, renderActions }: ColumnOptions): ColumnDef<RetentionRow>[] {
    return [
        {
            accessorKey: "name",
            header: "Policy",
            meta: { pin: "start" },
            cell: ({ row, table }) => (
                <NameCell
                    kind="retention"
                    name={row.original.name}
                    sub={policySub(row.original)}
                    badges={row.original.isSystem ? <BuiltInBadge /> : undefined}
                    compact={table.options.meta?.density === "compact"}
                    onOpen={() => onOpen(row.original)}
                />
            ),
        },
        {
            id: "mode",
            header: "Keeps",
            accessorFn: (row) => row.config.mode,
            filterFn: (row, id, value: string[]) => value.includes(row.getValue(id)),
            cell: ({ row }) => (
                <div className="min-w-0">
                    <span className="text-sm whitespace-nowrap">{describeConfig(row.original.config)}</span>
                    <TierBar config={row.original.config} />
                </div>
            ),
        },
        {
            id: "usedBy",
            header: "Used by",
            // A policy counts once for each destination in the numbers of the filter.
            accessorFn: destinationsOf,
            getUniqueValues: destinationsOf,
            filterFn: (row, id, value: string[]) => (row.getValue(id) as string[]).some((destinationId) => value.includes(destinationId)),
            cell: ({ row }) => (
                <div className="min-w-0 max-w-72">
                    <DestinationStack uses={row.original.uses} />
                    {row.original.uses.length > 0 && <p className="mt-0.5 text-xs text-muted-foreground">{reachOf(row.original)}</p>}
                </div>
            ),
        },
        {
            id: "default",
            header: "Default",
            cell: ({ row }) => {
                if (!row.original.isDefault) return null;
                const follow = row.original.uses.filter((use) => use.how === "default").length;
                return (
                    <div className="min-w-0">
                        <DefaultBadge />
                        <p className="mt-1 text-xs whitespace-nowrap text-muted-foreground">{follow === 1 ? "1 destination follows it" : `${follow.toLocaleString()} destinations follow it`}</p>
                    </div>
                );
            },
        },
        {
            id: "changed",
            header: "Changed",
            cell: ({ row }) => <RelativeTime date={row.original.updatedAt} className="text-sm whitespace-nowrap text-muted-foreground" />,
        },
        {
            id: "created",
            header: "Created",
            meta: { defaultHidden: true },
            cell: ({ row }) => <span className="text-sm whitespace-nowrap"><DateDisplay date={row.original.createdAt} format="P" /></span>,
        },
        {
            id: "actions",
            header: () => <span className="sr-only">Actions</span>,
            meta: { pin: "end", label: "Actions" },
            enableHiding: false,
            cell: ({ row }) => <div className="flex justify-end">{renderActions(row.original)}</div>,
        },
    ];
}

const MODE_ORDER: RetentionMode[] = ["NONE", "SIMPLE", "SMART"];

/** The Keeps and Used by filters, with only the values some policy has. */
export function retentionFilters(rows: RetentionRow[]): DataTableFilterableColumn<RetentionRow>[] {
    const shared = { note: "The numbers count the policies", unavailableLabel: "No policies with the other filters" };
    const destinations = new Map(rows.flatMap((row) => row.uses.map((use) => [use.destinationId, use] as const)));
    return [
        {
            id: "mode",
            title: "Keeps",
            ...shared,
            options: MODE_ORDER.filter((mode) => rows.some((row) => row.config.mode === mode)).map((mode) => ({ value: mode, label: RETENTION_MODES[mode] })),
        },
        {
            id: "usedBy",
            title: "Used by",
            ...shared,
            contentClassName: "w-72",
            options: [...destinations.values()]
                .sort((a, b) => a.destinationName.localeCompare(b.destinationName))
                .map((use) => ({ value: use.destinationId, label: use.destinationName, lead: <AdapterIcon adapterId={use.adapterId} className="size-4 shrink-0" /> })),
        },
    ];
}
