"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, Pencil, RefreshCw, X } from "lucide-react";
import { kindNames } from "@/components/adapter/connection-columns";
import { IssueBanner } from "@/components/adapter/connection-details-sections";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { signedBytes } from "@/components/dashboard/widgets/storage-history-data";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/utils";
import type { BackupRun, ExplorerDestination, ExplorerJob } from "@/services/storage/explorer-types";
import { targetsOf } from "./backup-filters";
import { DestinationAlertsCard, DestinationAlertsDialog } from "./destination-alerts";
import { DestinationHistory } from "./destination-history";
import { DestinationJobs } from "./destination-jobs";
import { jobsAt, limitShare, type DestinationJob } from "./destination-model";
import { AnswerText, DestinationTile } from "./explorer-cells";
import { count } from "./explorer-format";
import { ExplorerStrip } from "./explorer-strip";
import type { BackupTarget } from "./use-backup-actions";

interface DestinationDetailsProps {
    destination: ExplorerDestination;
    runs: BackupRun[];
    jobs: ExplorerJob[];
    destinations: Map<string, ExplorerDestination>;
    canDelete: boolean;
    canEditAlerts: boolean;
    onClose: () => void;
    onCheckNow: () => void;
    onDelete: (targets: BackupTarget[], title: string) => void;
    onChanged: () => void;
}

/**
 * What a destination holds and how it is doing, under the table of the destinations and as wide as
 * the page: whether it answers, its numbers, what it stored over time, its alerts and every job with
 * backups there.
 */
export function DestinationDetails({ destination, runs, jobs, destinations, canDelete, canEditAlerts, onClose, onCheckNow, onDelete, onChanged }: DestinationDetailsProps) {
    const [editing, setEditing] = useState(false);
    const entries = useMemo(() => jobsAt(destination.id, runs, jobs), [destination.id, runs, jobs]);
    const newest = entries.reduce<DestinationJob | null>((best, entry) => (entry.newest && (!best?.newest || entry.newest > best.newest) ? entry : best), null);
    const share = limitShare(destination);
    const [size, unit] = formatBytes(destination.size, 1).split(" ");
    const behind = destination.listError !== null || !destination.listedAt;

    const deleteJob = (entry: DestinationJob) => {
        const targets = runs.filter((run) => run.jobKey === entry.job.key).flatMap((run) => targetsOf(run, [destination.id]));
        onDelete(targets, `Delete the ${count(targets.length, "backup")} of ${entry.job.name} at ${destination.name}?`);
    };

    return (
        <section aria-label={`Details of ${destination.name}`} className="scroll-mt-4 space-y-4 md:space-y-6">
            <div className="flex flex-wrap items-center gap-3">
                <DestinationTile destination={destination} size="lg" />
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <h2 className="truncate text-lg font-semibold">{destination.name}</h2>
                        <AnswerText destination={destination} />
                    </div>
                    <p className="truncate text-sm text-muted-foreground">
                        {kindNames.get(destination.adapterId) ?? destination.adapterId} · {count(entries.length, "job")} with backups here
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
                    <Button variant="outline" size="sm" asChild>
                        <Link href={`/dashboard/storage?at=${encodeURIComponent(destination.id)}`}>
                            <ArrowRight />
                            Open backups
                        </Link>
                    </Button>
                    <Button variant="outline" size="sm" onClick={onCheckNow}>
                        <RefreshCw />
                        Check now
                    </Button>
                    {canEditAlerts && (
                        <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                            <Pencil />
                            Edit alerts
                        </Button>
                    )}
                    <Button variant="outline" size="sm" asChild>
                        <Link href="/dashboard/connections?tab=destinations">
                            <ArrowUpRight />
                            Open connection
                        </Link>
                    </Button>
                    <Button variant="ghost" size="icon" className="size-8" aria-label="Hide the details" onClick={onClose}>
                        <X />
                    </Button>
                </div>
            </div>

            {destination.health.status !== "ONLINE" && (
                <IssueBanner status={destination.health.status} error={destination.health.error} lastPassedAt={destination.health.answeredAt} />
            )}

            <ExplorerStrip
                cells={[
                    {
                        label: "Stored",
                        value: size,
                        unit,
                        extra: share !== null ? `${Math.round(share * 100)} % of ${formatBytes(destination.alerts.storageLimit.bytes)}` : "no limit set",
                        tone: share !== null && share >= 1 ? "warning" : undefined,
                    },
                    {
                        label: "Last 7 days",
                        value: destination.growth === null ? "-" : destination.growth === 0 ? "No change" : signedBytes(destination.growth),
                        extra: destination.growth === null ? "not measured a week ago" : "grown by",
                    },
                    { label: "Backups", value: destination.count.toLocaleString(), extra: `of ${count(entries.length, "job")}` },
                    {
                        label: "Newest",
                        value: newest?.newest ? <RelativeTime date={newest.newest} /> : "-",
                        extra: newest ? newest.job.name : undefined,
                    },
                    {
                        label: "List",
                        value: behind ? "Old" : destination.listedAt ? <RelativeTime date={destination.listedAt} /> : "-",
                        tone: behind ? "warning" : undefined,
                        extra: destination.listError ? "the last listing failed" : "compared with the storage",
                    },
                ]}
            />

            <div className="grid gap-4 md:gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
                <DestinationHistory destination={destination} />
                <DestinationAlertsCard destination={destination} onEdit={canEditAlerts ? () => setEditing(true) : undefined} />
            </div>

            <DestinationJobs destination={destination} entries={entries} destinations={destinations} canDelete={canDelete} onDelete={deleteJob} />

            <DestinationAlertsDialog destination={destination} open={editing} onOpenChange={setEditing} onSaved={onChanged} />
        </section>
    );
}
