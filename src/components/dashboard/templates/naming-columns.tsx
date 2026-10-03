"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { JobIcon } from "@/components/dashboard/storage/explorer/explorer-cells";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import type { DataTableFilterableColumn } from "@/components/ui/data-table";
import { DateDisplay } from "@/components/utils/date-display";
import type { NamingRow, TemplateJob } from "@/services/templates/templates-types";
import { nextFileOf, sampleFileOf, TokenPattern } from "./naming-cells";
import { BuiltInBadge, DefaultBadge, JobsStack, NameCell } from "./template-cells";
import { count } from "./template-format";

const jobIdsOf = (row: NamingRow) => row.uses.map((use) => use.jobId);

/** The jobs of a template, in the order of the list. */
export function jobsOf(row: NamingRow, jobs: Map<string, TemplateJob>): TemplateJob[] {
    return row.uses.map((use) => jobs.get(use.jobId)).filter((job): job is TemplateJob => job !== undefined);
}

/** The next file of the first job that uses a template, or a sample for one no job uses. */
export function NextFile({ row, jobs, timezone }: { row: NamingRow; jobs: Map<string, TemplateJob>; timezone: string }) {
    const first = jobsOf(row, jobs)[0];
    return (
        <div className="min-w-0 max-w-80">
            <p className="truncate font-mono text-xs">{first ? nextFileOf(row.pattern, first, timezone) : sampleFileOf(row.pattern, timezone)}</p>
            <p className="truncate text-xs text-muted-foreground">{first ? `next of ${first.name}` : "for a job called Shop nightly"}</p>
        </div>
    );
}

interface ColumnOptions {
    jobs: Map<string, TemplateJob>;
    timezone: string;
    onOpen: (row: NamingRow) => void;
    renderActions: (row: NamingRow) => React.ReactNode;
}

/** The columns of the file names. Name and actions stay put, the rest can move and hide. */
export function namingColumns({ jobs, timezone, onOpen, renderActions }: ColumnOptions): ColumnDef<NamingRow>[] {
    return [
        {
            accessorKey: "name",
            header: "Template",
            meta: { pin: "start" },
            cell: ({ row, table }) => (
                <NameCell
                    kind="naming"
                    name={row.original.name}
                    sub={row.original.description || "File names"}
                    badges={row.original.isSystem ? <BuiltInBadge /> : undefined}
                    compact={table.options.meta?.density === "compact"}
                    onOpen={() => onOpen(row.original)}
                />
            ),
        },
        {
            id: "pattern",
            header: "Pattern",
            cell: ({ row }) => <div className="max-w-72"><TokenPattern pattern={row.original.pattern} /></div>,
        },
        {
            id: "next",
            header: "Next file",
            cell: ({ row }) => <NextFile row={row.original} jobs={jobs} timezone={timezone} />,
        },
        {
            id: "usedBy",
            header: "Used by",
            // A template counts once for each job in the numbers of the filter.
            accessorFn: jobIdsOf,
            getUniqueValues: jobIdsOf,
            filterFn: (row, id, value: string[]) => (row.getValue(id) as string[]).some((jobId) => value.includes(jobId)),
            cell: ({ row }) => {
                const users = jobsOf(row.original, jobs);
                const picked = row.original.uses.filter((use) => use.how === "picked").length;
                return (
                    <div className="min-w-0 max-w-72">
                        <JobsStack jobs={users} />
                        {users.length > 0 && (
                            <p className="mt-0.5 text-xs text-muted-foreground">
                                {picked === users.length ? `picked in ${count(picked, "job")}` : `${count(users.length, "job")}, ${users.length - picked} by default`}
                            </p>
                        )}
                    </div>
                );
            },
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
                        <p className="mt-1 text-xs whitespace-nowrap text-muted-foreground">{follow === 1 ? "1 job follows it" : `${follow.toLocaleString()} jobs follow it`}</p>
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

/** The Used by filter, with only the jobs some template names. */
export function namingFilters(rows: NamingRow[], jobs: Map<string, TemplateJob>): DataTableFilterableColumn<NamingRow>[] {
    const used = [...new Set(rows.flatMap(jobIdsOf))].map((id) => jobs.get(id)).filter((job): job is TemplateJob => job !== undefined);
    return [
        {
            id: "usedBy",
            title: "Used by",
            note: "The numbers count the templates",
            unavailableLabel: "No templates with the other filters",
            contentClassName: "w-72",
            options: used
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((job) => ({
                    value: job.id,
                    label: job.name,
                    lead: <JobIcon job={{ kind: "job", sourceType: job.sourceType, hasFolders: job.hasFolders }} className="size-4 shrink-0" />,
                })),
        },
    ];
}
