"use client";

import { Pencil, Star } from "lucide-react";
import { DetailStats, FactList, Section } from "@/components/adapter/connection-details-sections";
import { describeSchedule } from "@/components/dashboard/jobs/job-schedule";
import { NotificationOverview } from "@/components/dashboard/jobs/notification-overview";
import type { BackupActionGroup } from "@/components/dashboard/storage/explorer/backup-actions";
import { listenersOf } from "@/components/templates/notification-model";
import { Button } from "@/components/ui/button";
import { DateDisplay } from "@/components/utils/date-display";
import type { NotificationRow, TemplateJob } from "@/services/templates/templates-types";
import { sendersOf } from "./notification-columns";
import { JobRowTile, UseList } from "./template-cells";
import { count, jobHref, listed } from "./template-format";
import { TemplateSheet, TemplateSheetBody, TemplateSheetHead } from "./template-sheet";

interface NotificationDetailsProps {
    open: boolean;
    /** Stays set while the panel slides out. */
    row: NotificationRow | null;
    jobs: Map<string, TemplateJob>;
    onClose: () => void;
    onEdit?: (row: NotificationRow) => void;
    onDefault?: (row: NotificationRow) => void;
    groups: BackupActionGroup[];
}

/** Everything about one notification template in a panel from the right: who hears about which run, and its jobs. */
export function NotificationDetails({ open, row, onClose, ...rest }: NotificationDetailsProps) {
    return (
        <TemplateSheet open={open && row !== null} onClose={onClose}>
            {row && <Content row={row} {...rest} />}
        </TemplateSheet>
    );
}

function Content({ row, jobs, onEdit, onDefault, groups }: Omit<NotificationDetailsProps, "open" | "row" | "onClose"> & { row: NotificationRow }) {
    const senders = sendersOf(row, jobs);
    const listeners = listenersOf([row], [], []);

    return (
        <>
            <TemplateSheetHead
                kind="notification"
                name={row.name}
                description={[row.description, row.isDefault && "Default for new jobs", row.isSystem && "Built in"].filter(Boolean).join(" · ") || count(row.channels.length, "channel")}
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
                                Default for new jobs
                            </Button>
                        )}
                    </>
                }
            />
            <TemplateSheetBody>
                <DetailStats
                    stats={[
                        { label: "Channels", value: row.channels.length.toLocaleString(), extra: row.channels.length > 0 ? listed(row.channels.map((channel) => channel.config.name)) : "none yet" },
                        { label: "Used by", value: senders.length.toLocaleString(), extra: senders.length === 1 ? "job" : "jobs" },
                        { label: "Default", value: row.isDefault ? "Yes" : "No", extra: row.isDefault ? "new jobs start with it" : "only where it is picked" },
                    ]}
                />

                {listeners.length > 0 ? (
                    <NotificationOverview listeners={listeners} />
                ) : (
                    <Section title="Who hears about a run">
                        <p className="text-sm text-muted-foreground">No channel hears about any run yet.</p>
                    </Section>
                )}

                <Section title={senders.length > 0 ? `Used by ${count(senders.length, "job")}` : "Used by"} aside={senders.length > 0 ? "a change reaches all of them" : undefined}>
                    {senders.length === 0 ? (
                        <p className="text-sm text-muted-foreground">{row.isDefault ? "No job sends through it yet. New jobs start with it." : "No job sends through it yet."}</p>
                    ) : (
                        <UseList
                            entries={senders.map((job) => ({
                                key: job.id,
                                href: jobHref(job.id),
                                tile: <JobRowTile job={job} />,
                                name: job.name,
                                detail: job.enabled ? describeSchedule(job.schedule).text : "Paused",
                            }))}
                        />
                    )}
                </Section>

                <Section title="Details">
                    <FactList
                        facts={[
                            { label: "Default", value: row.isDefault ? "New jobs start with it, jobs that exist keep theirs" : "No" },
                            { label: "Changed", value: <DateDisplay date={row.updatedAt} format="P" /> },
                            { label: "Created", value: <DateDisplay date={row.createdAt} format="P" /> },
                        ]}
                    />
                </Section>
            </TemplateSheetBody>
        </>
    );
}
