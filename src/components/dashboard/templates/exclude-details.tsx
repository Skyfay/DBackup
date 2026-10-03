"use client";

import { Pencil, Star } from "lucide-react";
import { DetailStats, FactList, Section } from "@/components/adapter/connection-details-sections";
import type { BackupActionGroup } from "@/components/dashboard/storage/explorer/backup-actions";
import { Button } from "@/components/ui/button";
import { DateDisplay } from "@/components/utils/date-display";
import { findExcludeGroup, resolveExcludePatterns, type ExcludeGroup } from "@/lib/exclude-groups";
import { cn } from "@/lib/utils";
import type { ExcludeRow, TemplateJob } from "@/services/templates/templates-types";
import { ConnectionRowTile, UseList } from "./template-cells";
import { count, jobHref } from "./template-format";
import { TemplateSheet, TemplateSheetBody, TemplateSheetHead } from "./template-sheet";

function Chips({ patterns, off = [] }: { patterns: string[]; off?: string[] }) {
    return (
        <div className="flex flex-wrap gap-1">
            {patterns.map((pattern) => (
                <span key={pattern} className={cn("rounded-md border px-1.5 py-0.5 font-mono text-xs", off.includes(pattern) && "text-muted-foreground line-through opacity-60")}>
                    {pattern}
                </span>
            ))}
        </div>
    );
}

/** The groups a preset follows, each with the patterns it leaves out struck through, and its own patterns. */
function WhatItSkips({ row }: { row: ExcludeRow }) {
    const groups = row.groups.map((id) => findExcludeGroup(id)).filter((group): group is ExcludeGroup => group !== undefined);
    if (groups.length === 0 && row.patterns.length === 0) return <p className="text-sm text-muted-foreground">It skips nothing yet.</p>;
    return (
        <ul className="divide-y rounded-lg border">
            {groups.map((group) => (
                <li key={group.id} className="space-y-2 px-3 py-2.5">
                    <p className="text-sm">
                        <span className="font-medium">{group.label}</span>
                        <span className="text-xs text-muted-foreground"> · a group of DBackup, follows its updates</span>
                    </p>
                    <Chips patterns={group.patterns} off={row.excludedGroupPatterns} />
                </li>
            ))}
            {row.patterns.length > 0 && (
                <li className="space-y-2 px-3 py-2.5">
                    <p className="text-sm font-medium">Its own patterns</p>
                    <Chips patterns={row.patterns} />
                </li>
            )}
        </ul>
    );
}

interface ExcludeDetailsProps {
    open: boolean;
    /** Stays set while the panel slides out. */
    row: ExcludeRow | null;
    jobs: Map<string, TemplateJob>;
    onClose: () => void;
    onEdit?: (row: ExcludeRow) => void;
    onDefault?: (row: ExcludeRow) => void;
    groups: BackupActionGroup[];
}

/** Everything about one exclude preset in a panel from the right: what it skips and which folders use it. */
export function ExcludeDetails({ open, row, onClose, ...rest }: ExcludeDetailsProps) {
    return (
        <TemplateSheet open={open && row !== null} onClose={onClose}>
            {row && <Content row={row} {...rest} />}
        </TemplateSheet>
    );
}

function Content({ row, jobs, onEdit, onDefault, groups }: Omit<ExcludeDetailsProps, "open" | "row" | "onClose"> & { row: ExcludeRow }) {
    const patterns = resolveExcludePatterns(row);
    const jobCount = new Set(row.folders.map((folder) => folder.jobId)).size;
    const leftOut = row.excludedGroupPatterns.filter((pattern) => row.groups.some((id) => findExcludeGroup(id)?.patterns.includes(pattern))).length;

    return (
        <>
            <TemplateSheetHead
                kind="exclude"
                name={row.name}
                description={[row.description, row.isDefault && "Default for new folders", row.isSystem && "Built in"].filter(Boolean).join(" · ") || count(patterns.length, "pattern")}
                groups={groups}
                buttons={
                    <>
                        {onEdit && (
                            <Button variant="outline" size="sm" onClick={() => onEdit(row)}>
                                <Pencil />
                                Edit
                            </Button>
                        )}
                        {onDefault && !row.isDefault && (
                            <Button variant="outline" size="sm" onClick={() => onDefault(row)}>
                                <Star />
                                Default for new folders
                            </Button>
                        )}
                    </>
                }
            />
            <TemplateSheetBody>
                <DetailStats
                    stats={[
                        { label: "Patterns", value: patterns.length.toLocaleString(), extra: `from ${count(row.groups.length, "group")} and ${row.patterns.length} own` },
                        { label: "Folders", value: row.folders.length.toLocaleString(), extra: `of ${count(jobCount, "job")}` },
                        { label: "Left out", value: leftOut.toLocaleString(), extra: leftOut === 1 ? "pattern of a group" : "patterns of its groups" },
                    ]}
                />

                <Section title="What it skips" aside={count(patterns.length, "pattern")}>
                    <WhatItSkips row={row} />
                </Section>

                <Section title={row.folders.length > 0 ? `Used by ${count(row.folders.length, "folder")}` : "Used by"} aside={row.folders.length > 0 ? "a change reaches their next run" : undefined}>
                    {row.folders.length === 0 ? (
                        <p className="text-sm text-muted-foreground">{row.isDefault ? "No folder uses it yet. New folders start with it." : "No folder uses it yet."}</p>
                    ) : (
                        <UseList
                            entries={row.folders.map((folder) => ({
                                key: folder.id,
                                href: jobHref(folder.jobId),
                                tile: <ConnectionRowTile adapterId={folder.adapterId} />,
                                name: folder.path,
                                detail: `folder of ${jobs.get(folder.jobId)?.name ?? "a job"} at ${folder.connectionName}`,
                            }))}
                        />
                    )}
                </Section>

                <Section title="Details">
                    <FactList
                        facts={[
                            { label: "Default", value: row.isDefault ? "New folders start with it" : "No" },
                            { label: "Built in", value: row.isSystem ? "Yes, it can be edited but not deleted" : "No" },
                            { label: "Changed", value: <DateDisplay date={row.updatedAt} format="P" /> },
                            { label: "Created", value: <DateDisplay date={row.createdAt} format="P" /> },
                        ]}
                    />
                </Section>
            </TemplateSheetBody>
        </>
    );
}
