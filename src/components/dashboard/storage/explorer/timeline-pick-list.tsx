"use client";

import { Archive, CalendarDays, List } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PickList, type PickEntry, type PickGroup } from "@/components/ui/pick-list";
import { formatBytes } from "@/lib/utils";
import type { BackupRun, ExplorerDestination, ExplorerJob } from "@/services/storage/explorer-types";
import { copiesIn, runKey } from "./backup-filters";
import { JobIcon } from "./explorer-cells";
import { count, typeLabel } from "./explorer-format";
import type { TimelineFormat } from "./timeline-cells";
import type { DayKey, TimelinePick, TimelineRow } from "./timeline-model";
import { itemsOfPick, type PickItem } from "./timeline-pick-model";

interface TimelinePickListProps {
    pick: TimelinePick;
    rows: TimelineRow[];
    days: DayKey[];
    today: DayKey;
    destinations: Map<string, ExplorerDestination>;
    format: TimelineFormat;
    at: string[];
    /** The backup opened from the list last, ticked. */
    value: string | null;
    onOpenRun: (run: BackupRun) => void;
    /** A run that did not start leads to its job. */
    onOpenJob: (job: ExplorerJob) => void;
    onShowInList: () => void;
}

const idOf = (item: PickItem) => (item.kind === "backup" ? runKey(item.run) : `missed:${item.job.key}:${item.at}`);

/**
 * What a click on the timeline lists, where the click was: the backups of a day by the time of day,
 * of a job in view newest first, or of a job on a day, with a failed check, a missing copy and a run
 * that did not start on top. A backup opens in its details, Show in the list moves to the list view.
 */
export function TimelinePickList({ pick, rows, days, today, destinations, format, at, value, onOpenRun, onOpenJob, onShowInList }: TimelinePickListProps) {
    const { look, rest, backups, jobs } = itemsOfPick(rows, days, pick, at);
    const scope = !pick.jobKey ? "day" : pick.from === pick.to ? "cell" : "job";
    const job = pick.jobKey ? rows.find((row) => row.job.key === pick.jobKey)?.job : undefined;
    const names = (ids: string[]) => ids.map((id) => destinations.get(id)?.name ?? "a removed destination").join(", ");

    // A day names the job of each entry, a job its day, and a day of a job only the time.
    const nameOf = (item: PickItem) => (scope === "day" ? item.job.name : scope === "job" ? `${format.date(item.day)}, ${format.time(item.at)}` : format.time(item.at));

    const entryOf = (item: PickItem): PickEntry => {
        const name = nameOf(item);
        const icon = scope === "day" ? <JobIcon job={item.job} className="size-4" /> : undefined;
        if (item.kind === "missed") {
            const text = item.runs === 1 ? `Run of ${format.time(item.at)} did not start` : `None of its ${item.runs} runs started`;
            return { id: idOf(item), name, meta: "Opens the job", icon, value: `${name} ${text} ${idOf(item)}`, alert: { text, tone: "destructive" } };
        }
        const { run, problem } = item;
        const stored = copiesIn(run, at).filter((copy) => copy.state === "stored").map((copy) => copy.destinationId);
        const meta = [
            scope === "day" ? format.time(item.at) : null,
            run.file.chain ? typeLabel(run.file) : null,
            formatBytes(run.file.size, 1),
            stored.length > 0 ? names(stored) : "No copy stored",
        ].filter((part) => part !== null).join(" · ");
        const alert = problem?.kind === "failed"
            ? { text: "Check failed", tone: "destructive" as const }
            : problem?.kind === "missing"
                ? { text: `${problem.destinationIds.length === 1 ? "Copy" : "Copies"} on ${names(problem.destinationIds)} missing`, tone: "warning" as const }
                : undefined;
        return { id: idOf(item), name, meta, icon, value: `${name} ${meta} ${idOf(item)}`, keywords: alert ? [alert.text] : undefined, alert };
    };

    const groups: PickGroup[] = look.length > 0
        ? [{ heading: "Needs a look", entries: look.map(entryOf) }, { heading: "Everything else", entries: rest.map(entryOf) }]
        : [{ entries: rest.map(entryOf) }];
    const byId = new Map([...look, ...rest].map((item) => [idOf(item), item]));

    const title = scope === "day" ? format.long(pick.from) : scope === "job" ? job?.name ?? "Backups" : `${job?.name ?? "Backups"} · ${format.date(pick.from)}`;
    const note = scope === "day"
        ? backups === 0 ? "No backups that day" : `${count(backups, "backup")} of ${count(jobs, "job")}`
        : scope === "job"
            ? `${count(backups, "backup")} from ${format.short(pick.from)} to ${pick.to === today ? "today" : format.short(pick.to)}`
            : count(backups, "backup");

    return (
        <PickList
            icon={scope === "day" ? CalendarDays : Archive}
            title={title}
            note={note}
            groups={groups}
            value={value}
            emptyText={byId.size === 0 ? (scope === "day" ? "No backup that day." : "No backup in view.") : "Nothing matches."}
            onPick={(id) => {
                const item = byId.get(id);
                if (item?.kind === "backup") onOpenRun(item.run);
                else if (item) onOpenJob(item.job);
            }}
            searchPlaceholder={scope === "day" ? "Search by job, time or destination" : "Search by date, time or destination"}
            // The list of a whole day is often long, so it takes the height the window leaves.
            listClassName="max-h-[min(30rem,calc(var(--radix-popover-content-available-height)-10rem))]"
            aside={
                <Button type="button" variant="outline" size="sm" onClick={onShowInList}>
                    <List />
                    Show in the list
                </Button>
            }
        />
    );
}
