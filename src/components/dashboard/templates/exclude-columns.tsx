"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { AdapterIcon } from "@/components/adapter/adapter-icon";
import { JobIcon } from "@/components/dashboard/storage/explorer/explorer-cells";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import type { DataTableFilterableColumn } from "@/components/ui/data-table";
import { DateDisplay } from "@/components/utils/date-display";
import { EXCLUDE_GROUPS, findExcludeGroup, resolveExcludePatterns } from "@/lib/exclude-groups";
import type { ExcludeRow, TemplateJob } from "@/services/templates/templates-types";
import { BuiltInBadge, DefaultBadge, NameCell, UsageStack } from "./template-cells";
import { count } from "./template-format";

/** "Development artifacts, Version control and its own", where the patterns come from. */
export function sourcesOf(row: ExcludeRow): string {
    const parts = [...row.groups.map((id) => findExcludeGroup(id)?.label).filter((label): label is string => Boolean(label)), ...(row.patterns.length > 0 ? ["its own"] : [])];
    if (parts.length === 0) return "no pattern yet";
    return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** The folders of a preset as round logos with the paths, and of how many jobs. */
export function FolderStack({ row }: { row: ExcludeRow }) {
    const jobs = new Set(row.folders.map((folder) => folder.jobId)).size;
    return (
        <div className="min-w-0">
            <UsageStack
                empty="no folder"
                entries={row.folders.map((folder) => ({ key: folder.id, logo: <AdapterIcon adapterId={folder.adapterId} className="size-3" />, name: folder.path }))}
            />
            {row.folders.length > 0 && <p className="mt-0.5 text-xs text-muted-foreground">{count(row.folders.length, "folder")} of {count(jobs, "job")}</p>}
        </div>
    );
}

const jobIdsOf = (row: ExcludeRow) => [...new Set(row.folders.map((folder) => folder.jobId))];

interface ColumnOptions {
    onOpen: (row: ExcludeRow) => void;
    renderActions: (row: ExcludeRow) => React.ReactNode;
}

/** The columns of the exclude presets. Name and actions stay put, the rest can move and hide. */
export function excludeColumns({ onOpen, renderActions }: ColumnOptions): ColumnDef<ExcludeRow>[] {
    return [
        {
            accessorKey: "name",
            header: "Preset",
            meta: { pin: "start" },
            cell: ({ row, table }) => (
                <NameCell
                    kind="exclude"
                    name={row.original.name}
                    sub={row.original.description || sourcesOf(row.original)}
                    badges={row.original.isSystem ? <BuiltInBadge /> : undefined}
                    compact={table.options.meta?.density === "compact"}
                    onOpen={() => onOpen(row.original)}
                />
            ),
        },
        {
            id: "groups",
            header: "Skips",
            accessorFn: (row) => row.groups,
            getUniqueValues: (row) => row.groups,
            filterFn: (row, id, value: string[]) => (row.getValue(id) as string[]).some((group) => value.includes(group)),
            cell: ({ row }) => (
                <div className="min-w-0 max-w-72">
                    <p className="text-sm whitespace-nowrap">{count(resolveExcludePatterns(row.original).length, "pattern")}</p>
                    <p className="truncate text-xs text-muted-foreground">{sourcesOf(row.original)}</p>
                </div>
            ),
        },
        {
            id: "usedBy",
            header: "Used by",
            // A preset counts once for each job in the numbers of the filter.
            accessorFn: jobIdsOf,
            getUniqueValues: jobIdsOf,
            filterFn: (row, id, value: string[]) => (row.getValue(id) as string[]).some((jobId) => value.includes(jobId)),
            cell: ({ row }) => <div className="max-w-72"><FolderStack row={row.original} /></div>,
        },
        {
            id: "default",
            header: "Default",
            cell: ({ row }) =>
                row.original.isDefault ? (
                    <div className="min-w-0">
                        <DefaultBadge />
                        <p className="mt-1 text-xs whitespace-nowrap text-muted-foreground">new folders start with it</p>
                    </div>
                ) : null,
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

/** The Group and Used by filters, with only the values some preset has. */
export function excludeFilters(rows: ExcludeRow[], jobs: Map<string, TemplateJob>): DataTableFilterableColumn<ExcludeRow>[] {
    const shared = { note: "The numbers count the presets", unavailableLabel: "No presets with the other filters" };
    const users = [...new Set(rows.flatMap(jobIdsOf))].map((id) => jobs.get(id)).filter((job): job is TemplateJob => job !== undefined);
    return [
        {
            id: "groups",
            title: "Group",
            ...shared,
            options: EXCLUDE_GROUPS.filter((group) => rows.some((row) => row.groups.includes(group.id))).map((group) => ({ value: group.id, label: group.label })),
        },
        {
            id: "usedBy",
            title: "Used by",
            ...shared,
            contentClassName: "w-72",
            options: users
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((job) => ({
                    value: job.id,
                    label: job.name,
                    lead: <JobIcon job={{ kind: "job", sourceType: job.sourceType, hasFolders: job.hasFolders }} className="size-4 shrink-0" />,
                })),
        },
    ];
}
