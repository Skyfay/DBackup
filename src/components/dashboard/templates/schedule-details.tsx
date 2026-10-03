"use client";

import { Pencil } from "lucide-react";
import { DetailStats, FactList, Section } from "@/components/adapter/connection-details-sections";
import { describeSchedule } from "@/components/dashboard/jobs/job-schedule";
import type { BackupActionGroup } from "@/components/dashboard/storage/explorer/backup-actions";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { Button } from "@/components/ui/button";
import { DateDisplay } from "@/components/utils/date-display";
import { nextRunTimes } from "@/lib/core/cron";
import type { ScheduleRow, TemplateJob } from "@/services/templates/templates-types";
import { followersOf } from "./schedule-columns";
import { JobRowTile, UseList } from "./template-cells";
import { count, jobHref } from "./template-format";
import { TemplateSheet, TemplateSheetBody, TemplateSheetHead } from "./template-sheet";

interface ScheduleDetailsProps {
    open: boolean;
    /** Stays set while the panel slides out. */
    row: ScheduleRow | null;
    jobs: Map<string, TemplateJob>;
    timezone: string;
    onClose: () => void;
    onEdit?: (row: ScheduleRow) => void;
    groups: BackupActionGroup[];
}

/** Everything about one schedule preset in a panel from the right: when it runs and which jobs start with it. */
export function ScheduleDetails({ open, row, onClose, ...rest }: ScheduleDetailsProps) {
    return (
        <TemplateSheet open={open && row !== null} onClose={onClose}>
            {row && <Content row={row} {...rest} />}
        </TemplateSheet>
    );
}

function Content({ row, jobs, timezone, onEdit, groups }: Omit<ScheduleDetailsProps, "open" | "row" | "onClose"> & { row: ScheduleRow }) {
    const followers = followersOf(row, jobs);
    const next = nextRunTimes(row.schedule, timezone, 5);
    const words = describeSchedule(row.schedule).text;

    return (
        <>
            <TemplateSheetHead
                kind="schedule"
                name={row.name}
                description={[words, row.description].filter(Boolean).join(" · ")}
                groups={groups}
                buttons={
                    onEdit && (
                        <Button variant="outline" size="sm" onClick={() => onEdit(row)}>
                            <Pencil />
                            Edit
                        </Button>
                    )
                }
            />
            <TemplateSheetBody>
                <DetailStats
                    stats={[
                        { label: "Runs", value: words, extra: `in ${timezone}` },
                        { label: "Next run", value: next[0] ? <RelativeTime date={next[0]} /> : "Never", extra: next[0] ? <DateDisplay date={next[0]} format="Pp" /> : "the schedule has no run" },
                        { label: "Jobs", value: followers.length.toLocaleString(), extra: followers.length > 1 ? "start together" : followers.length === 1 ? "follows it" : "none follows it" },
                    ]}
                />

                <Section title="Next runs" aside={`in ${timezone}`}>
                    {next.length === 0 ? (
                        <p className="text-sm text-muted-foreground">This schedule never starts a run.</p>
                    ) : (
                        <ul className="divide-y rounded-lg border">
                            {next.map((at) => (
                                <li key={at.toISOString()} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                                    <DateDisplay date={at} format="PPpp" />
                                    <RelativeTime date={at} className="shrink-0 text-xs text-muted-foreground" />
                                </li>
                            ))}
                        </ul>
                    )}
                </Section>

                <Section title={followers.length > 0 ? `Used by ${count(followers.length, "job")}` : "Used by"} aside={followers.length > 0 ? "a change moves all of them" : undefined}>
                    {followers.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No job follows it yet.</p>
                    ) : (
                        <UseList
                            entries={followers.map((job) => ({
                                key: job.id,
                                href: jobHref(job.id),
                                tile: <JobRowTile job={job} />,
                                name: job.name,
                                detail: job.enabled ? "Follows the preset" : "Paused, follows the preset once it runs again",
                            }))}
                        />
                    )}
                </Section>

                <Section title="Details">
                    <FactList
                        facts={[
                            { label: "Cron", value: <span className="font-mono text-xs">{row.schedule}</span> },
                            { label: "Changed", value: <DateDisplay date={row.updatedAt} format="P" /> },
                            { label: "Created", value: <DateDisplay date={row.createdAt} format="P" /> },
                        ]}
                    />
                </Section>
            </TemplateSheetBody>
        </>
    );
}
