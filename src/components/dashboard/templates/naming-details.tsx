"use client";

import { Pencil, Star, TriangleAlert } from "lucide-react";
import { DetailStats, FactList, Section } from "@/components/adapter/connection-details-sections";
import { describeSchedule } from "@/components/dashboard/jobs/job-schedule";
import type { BackupActionGroup } from "@/components/dashboard/storage/explorer/backup-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DateDisplay } from "@/components/utils/date-display";
import { patternUsesChain } from "@/lib/templates/naming-template-engine";
import type { NamingRow, TemplateJob } from "@/services/templates/templates-types";
import { clashingJobs, nextFileOf, sampleFileOf, TokenPattern } from "./naming-cells";
import { jobsOf } from "./naming-columns";
import { JobRowTile, UseList } from "./template-cells";
import { count, jobHref, listed } from "./template-format";
import { TemplateSheet, TemplateSheetBody, TemplateSheetHead } from "./template-sheet";

interface NamingDetailsProps {
    open: boolean;
    /** Stays set while the panel slides out. */
    row: NamingRow | null;
    jobs: Map<string, TemplateJob>;
    timezone: string;
    onClose: () => void;
    onEdit?: (row: NamingRow) => void;
    onDefault?: (row: NamingRow) => void;
    groups: BackupActionGroup[];
}

/** Everything about one file name template in a panel from the right: its pattern and the next files of its jobs. */
export function NamingDetails({ open, row, onClose, ...rest }: NamingDetailsProps) {
    return (
        <TemplateSheet open={open && row !== null} onClose={onClose}>
            {row && <Content row={row} {...rest} />}
        </TemplateSheet>
    );
}

function Content({ row, jobs, timezone, onEdit, onDefault, groups }: Omit<NamingDetailsProps, "open" | "row" | "onClose"> & { row: NamingRow }) {
    const users = jobsOf(row, jobs);
    const picked = row.uses.filter((use) => use.how === "picked").length;
    const clashes = clashingJobs(row, jobs, timezone);
    const shown = users.slice(0, 5);

    return (
        <>
            <TemplateSheetHead
                kind="naming"
                name={row.name}
                description={[row.isDefault && "Default template", row.isSystem && "Built in", row.description].filter(Boolean).join(" · ") || "File names"}
                groups={groups}
                buttons={
                    <>
                        {onEdit && !row.isSystem && (
                            <Button variant="outline" size="sm" onClick={() => onEdit(row)}>
                                <Pencil />
                                Edit
                            </Button>
                        )}
                        {onDefault && !row.isDefault && (
                            <Button variant="outline" size="sm" onClick={() => onDefault(row)}>
                                <Star />
                                Make default
                            </Button>
                        )}
                    </>
                }
            />
            <TemplateSheetBody>
                <DetailStats
                    stats={[
                        { label: "Jobs", value: users.length.toLocaleString(), extra: users.length === 0 ? "none uses it yet" : `${picked} picked, ${users.length - picked} by default` },
                        { label: "Default", value: row.isDefault ? "Yes" : "No", extra: row.isDefault ? "for jobs without their own" : "only where it is picked" },
                        {
                            label: "Names repeat",
                            value: clashes.length.toLocaleString(),
                            className: clashes.length > 0 ? "text-warning" : undefined,
                            extra: clashes.length > 0 ? "runs replace each other" : "every run gets its own",
                        },
                    ]}
                />

                <Section title="Pattern" aside={`times in ${timezone}`}>
                    <div className="rounded-lg border bg-muted/30 p-3">
                        <TokenPattern pattern={row.pattern} className="text-sm" />
                    </div>
                    {patternUsesChain(row.pattern) && (
                        <p className="text-xs text-muted-foreground">{"{chain}"} stays empty for a full backup and becomes inc-001 for the first incremental.</p>
                    )}
                </Section>

                <Section title={users.length > 0 ? "The next files of its jobs" : "A file it names"}>
                    <ul className="divide-y rounded-lg border">
                        {users.length === 0 ? (
                            <li className="px-3 py-2">
                                <p className="truncate font-mono text-xs">{sampleFileOf(row.pattern, timezone)}</p>
                                <p className="text-xs text-muted-foreground">for a job called Shop nightly, backed up now</p>
                            </li>
                        ) : (
                            shown.map((job) => (
                                <li key={job.id} className="flex min-w-0 items-center gap-3 px-3 py-2">
                                    <JobRowTile job={job} />
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate font-mono text-xs">{nextFileOf(row.pattern, job, timezone)}</p>
                                        <p className="truncate text-xs text-muted-foreground">{job.name}</p>
                                    </div>
                                </li>
                            ))
                        )}
                        {users.length > shown.length && <li className="px-3 py-2 text-xs text-muted-foreground">and {count(users.length - shown.length, "more job")}</li>}
                    </ul>
                    {clashes.length > 0 && (
                        <div role="status" className="flex gap-2.5 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
                            <TriangleAlert className="mt-px size-4 shrink-0 text-warning" aria-hidden="true" />
                            <span>
                                {listed(clashes.map((job) => job.name))} {clashes.length === 1 ? "runs" : "run"} more often than the pattern tells apart, so a later run replaces the backup of an earlier one at every destination.
                            </span>
                        </div>
                    )}
                </Section>

                <Section title={users.length > 0 ? `Used by ${count(users.length, "job")}` : "Used by"} aside={users.length > 0 ? "a change names their next files" : undefined}>
                    {users.length === 0 ? (
                        <p className="text-sm text-muted-foreground">{row.isDefault ? "Every job has a template of its own, so none follows the default." : "No job names its files with it yet."}</p>
                    ) : (
                        <UseList
                            entries={users.map((job) => ({
                                key: job.id,
                                href: jobHref(job.id),
                                tile: <JobRowTile job={job} />,
                                name: job.name,
                                detail: job.enabled ? describeSchedule(job.schedule).text : "Paused",
                                aside: <Badge variant="outline" className="font-normal">{row.uses.find((use) => use.jobId === job.id)?.how === "picked" ? "Picked" : "Default"}</Badge>,
                            }))}
                        />
                    )}
                </Section>

                <Section title="Details">
                    <FactList
                        facts={[
                            { label: "Built in", value: row.isSystem ? "Yes, it cannot be changed" : "No" },
                            { label: "Changed", value: <DateDisplay date={row.updatedAt} format="P" /> },
                            { label: "Created", value: <DateDisplay date={row.createdAt} format="P" /> },
                        ]}
                    />
                </Section>
            </TemplateSheetBody>
        </>
    );
}
