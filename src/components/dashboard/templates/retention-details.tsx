"use client";

import { Pencil, Star } from "lucide-react";
import { DetailStats, FactList, Section } from "@/components/adapter/connection-details-sections";
import type { BackupActionGroup } from "@/components/dashboard/storage/explorer/backup-actions";
import { RETENTION_MODES, RETENTION_TIERS } from "@/components/templates/retention-words";
import { useRetentionTargets } from "@/components/templates/use-retention-targets";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DateDisplay } from "@/components/utils/date-display";
import type { RetentionConfiguration } from "@/lib/core/retention";
import { cn } from "@/lib/utils";
import { mostKept } from "@/services/templates/retention-preview";
import type { RetentionRow } from "@/services/templates/templates-types";
import { ConnectionRowTile, UseList } from "./template-cells";
import { count, destinationHref, jobHref } from "./template-format";
import { TemplateSheet, TemplateSheetBody, TemplateSheetHead } from "./template-sheet";

const COLUMNS = ["", "sm:grid-cols-1", "sm:grid-cols-2", "sm:grid-cols-3", "sm:grid-cols-4", "sm:grid-cols-5"];

/** What a policy keeps: a cell per tier of a smart one, a sentence for the others. */
function WhatItKeeps({ config }: { config: RetentionConfiguration }) {
    if (config.mode === "SIMPLE") {
        return <p className="text-sm">The newest {config.simple?.keepCount ?? 0} at every destination, however old they are. Locked backups always stay.</p>;
    }
    const smart = config.mode === "SMART" ? config.smart : undefined;
    const tiers = smart ? RETENTION_TIERS.filter((tier) => (smart[tier.key] ?? 0) > 0) : [];
    if (!smart || tiers.length === 0) return <p className="text-sm">Every backup, so the storage grows with every run.</p>;
    return (
        <div className="space-y-2">
            <div className={cn("grid grid-cols-2 gap-2", COLUMNS[tiers.length])}>
                {tiers.map((tier) => (
                    <div key={tier.key} className="min-w-0 rounded-lg border bg-muted/30 px-3 py-2.5">
                        <p className="text-xs text-muted-foreground">{tier.label}</p>
                        <p className="mt-0.5 text-lg font-semibold tabular-nums">{smart[tier.key]}</p>
                        <p className="text-xs text-muted-foreground">the newest of each {tier.unit}</p>
                    </div>
                ))}
            </div>
            <p className="text-xs text-muted-foreground">The tiers add up, each keeps that many on top of what the finer ones cover. Locked backups always stay.</p>
        </div>
    );
}

interface RetentionDetailsProps {
    open: boolean;
    /** Stays set while the panel slides out. */
    row: RetentionRow | null;
    jobNames: Map<string, string>;
    onClose: () => void;
    onEdit?: (row: RetentionRow) => void;
    onDefault?: (row: RetentionRow) => void;
    groups: BackupActionGroup[];
}

/** Everything about one retention policy in a panel from the right: what it keeps and where. */
export function RetentionDetails({ open, row, onClose, ...rest }: RetentionDetailsProps) {
    return (
        <TemplateSheet open={open && row !== null} onClose={onClose}>
            {row && <Content row={row} {...rest} />}
        </TemplateSheet>
    );
}

function Content({ row, jobNames, onEdit, onDefault, groups }: Omit<RetentionDetailsProps, "open" | "row" | "onClose"> & { row: RetentionRow }) {
    // What the destinations hold now, which only the listings know. It fills in when they answer.
    const { targets } = useRetentionTargets(row.uses.length > 0 ? { policyId: row.id } : null);
    const holds = targets ? targets.targets.reduce((sum, target) => sum + target.backups.length, 0) : null;
    const most = mostKept(row.config);
    const picked = row.uses.filter((use) => use.how === "picked").length;
    const follow = row.uses.length - picked;
    const jobs = new Set(row.uses.map((use) => use.jobId)).size;

    return (
        <>
            <TemplateSheetHead
                kind="retention"
                name={row.name}
                description={[RETENTION_MODES[row.config.mode], row.isDefault && "Default policy", row.isSystem && "Built in"].filter(Boolean).join(" · ")}
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
                                Make default
                            </Button>
                        )}
                    </>
                }
            />
            <TemplateSheetBody>
                <DetailStats
                    stats={[
                        { label: "Keeps at most", value: most === null ? "All" : most.toLocaleString(), extra: most === null ? "never removes a backup" : "backups a destination" },
                        { label: "Destinations", value: row.uses.length.toLocaleString(), extra: `in ${count(jobs, "job")}` },
                        { label: "Default", value: row.isDefault ? "Yes" : "No", extra: row.isDefault ? `${follow.toLocaleString()} follow it` : "only where it is picked" },
                        { label: "Holds now", value: holds === null ? "-" : holds.toLocaleString(), extra: row.uses.length > 0 ? "backups at them" : "no destination yet" },
                    ]}
                />

                <Section title="What it keeps" aside="at every destination">
                    <WhatItKeeps config={row.config} />
                </Section>

                <Section
                    title={row.uses.length > 0 ? `Used by ${count(row.uses.length, "destination")}` : "Used by"}
                    aside={row.uses.length > 0 ? [picked > 0 && `${picked} picked`, follow > 0 && `${follow} follow the default`].filter(Boolean).join(", ") : undefined}
                >
                    {row.uses.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                            {row.isDefault ? "Every destination has a policy of its own, so none follows the default." : "No destination keeps its backups by it yet."}
                        </p>
                    ) : (
                        <UseList
                            entries={row.uses.map((use) => ({
                                key: `${use.jobId}-${use.destinationId}`,
                                href: jobHref(use.jobId),
                                tile: <ConnectionRowTile adapterId={use.adapterId} />,
                                name: `${use.destinationName} of ${jobNames.get(use.jobId) ?? "a job"}`,
                                detail: use.how === "picked" ? "Picked in the job" : "No policy of its own, follows the default",
                                aside: <Badge variant="outline" className="font-normal">{use.how === "picked" ? "Picked" : "Default"}</Badge>,
                            }))}
                        />
                    )}
                </Section>

                {row.prefills.length > 0 && (
                    <Section title="Starts new jobs" aside={count(row.prefills.length, "connection")}>
                        <UseList
                            entries={row.prefills.map((connection) => ({
                                key: connection.id,
                                href: destinationHref(connection.id),
                                tile: <ConnectionRowTile adapterId={connection.adapterId} />,
                                name: connection.name,
                                detail: "A new job starts this destination with it",
                            }))}
                        />
                    </Section>
                )}

                <Section title="Details">
                    <FactList
                        facts={[
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
