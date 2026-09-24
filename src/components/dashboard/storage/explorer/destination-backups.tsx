"use client";

import { useMemo, useState } from "react";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { useDateFormatter } from "@/hooks/use-date-formatter";
import { formatBytes } from "@/lib/utils";
import type { DestinationBackup, ExplorerDestination, ExplorerDestinationView, ExplorerFile, ExplorerJob } from "@/services/storage/explorer-types";
import type { BackupActionHandlers } from "./backup-actions";
import { BackupTimeline, dayStartOf, type TimelineLane } from "./backup-timeline";
import { DestinationBackupTable } from "./destination-backup-table";
import { FolderHead, FolderList, FolderTile } from "./destination-folder-list";
import { foldersOf } from "./destination-folders";
import { DayChip, ListSwitch } from "./explorer-controls";
import { count, isIncremental, madeAt, typeLabel } from "./explorer-format";
import { ExplorerStrip } from "./explorer-strip";
import type { BackupTarget } from "./use-backup-actions";

/** A folder per job like on the storage, or every backup in one list for actions across jobs. */
export type DestinationLayout = "folders" | "all";

interface DestinationBackupsProps {
    view: ExplorerDestinationView;
    jobs: Map<string, ExplorerJob>;
    destinations: Map<string, ExplorerDestination>;
    display: "table" | "timeline";
    layout: DestinationLayout;
    onLayout: (next: DestinationLayout) => void;
    /** The job whose folder is open, from the address. */
    folder: string | null;
    onFolder: (key: string | null) => void;
    canDelete: boolean;
    handlersFor: (file: ExplorerFile, destinationId: string) => BackupActionHandlers;
    askDelete: (targets: BackupTarget[], title?: string) => void;
    onOpen: (backup: DestinationBackup) => void;
    onOpenJob: (key: string) => void;
    openPath: string | null;
    onChanged: () => void;
}

/**
 * The backups of one destination, as a folder per job to open or as one list of every backup,
 * where backups of different jobs can be locked or deleted together. The timeline has a lane per
 * job, and a click on a lane opens its folder below it.
 */
export function DestinationBackups({
    view,
    jobs,
    destinations,
    display,
    layout,
    onLayout,
    folder,
    onFolder,
    canDelete,
    handlersFor,
    askDelete,
    onOpen,
    onOpenJob,
    openPath,
    onChanged,
}: DestinationBackupsProps) {
    const { destination, backups } = view;
    const { formatDate } = useDateFormatter();
    const folders = useMemo(() => foldersOf(backups, jobs), [backups, jobs]);
    // A folder whose last backup was deleted is gone, so the view falls back to the list.
    const open = folder ? folders.find((entry) => entry.key === folder) ?? null : null;
    // A day picked on the timeline narrows the open folder to the backups of that day.
    const [picked, setPicked] = useState<{ folder: string; day: number } | null>(null);
    const day = display === "timeline" && open && picked?.folder === open.key ? picked.day : null;
    const folderRows = useMemo(
        () => (!open ? [] : day === null ? open.backups : open.backups.filter((backup) => dayStartOf(Date.parse(madeAt(backup.file))) === day)),
        [open, day]
    );

    const locked = backups.filter((backup) => backup.file.locked).length;
    const failed = backups.filter((backup) => backup.file.verification?.passed === false).length;
    const checked = backups.filter((backup) => backup.file.verification).length;
    const [sizeValue, sizeUnit] = formatBytes(destination.size, 1).split(" ");
    const newest = backups[0];
    const activeJobs = folders.filter((entry) => entry.kind === "job").length;
    const deletedJobs = folders.filter((entry) => entry.kind === "deleted").length;

    const lanes: TimelineLane[] = folders.map((entry) => ({
        key: entry.key,
        title: entry.name,
        note: `${count(entry.backups.length, "backup")} · ${formatBytes(entry.size, 1)}`,
        icon: <FolderTile folder={entry} destination={destination} />,
        muted: entry.kind !== "job",
        endNote: entry.kind === "deleted" ? "The job was deleted, retention stopped with it" : undefined,
        points: entry.backups.map((backup) => ({
            id: backup.file.path,
            time: Date.parse(madeAt(backup.file)),
            chainId: backup.file.chain?.id,
            full: backup.file.chain?.type === "full",
            incremental: isIncremental(backup.file),
            state: backup.file.verification?.passed === false ? "failed" : backup.elsewhere.some((copy) => copy.state === "missing") ? "missing" : "ok",
            locked: backup.file.locked,
            label: `${formatDate(madeAt(backup.file), "Pp")} · ${typeLabel(backup.file)}`,
        })),
    }));

    const tableFor = (rows: DestinationBackup[], showJob: boolean, toolbarExtra?: React.ReactNode) => (
        <DestinationBackupTable
            // Another folder or day starts with its own filter and selection.
            key={`${open?.key ?? "all"}:${day ?? "all"}`}
            destination={destination}
            rows={rows}
            jobs={jobs}
            destinations={destinations}
            showJob={showJob}
            canDelete={canDelete}
            handlersFor={handlersFor}
            onOpen={onOpen}
            onChanged={onChanged}
            toolbarExtra={toolbarExtra}
        />
    );
    const layoutSwitch = (
        <ListSwitch<DestinationLayout>
            aria-label="Show the backups"
            value={layout}
            onChange={onLayout}
            options={[{ value: "folders", label: "Folders" }, { value: "all", label: "All backups" }]}
        />
    );

    let content: React.ReactNode = null;
    if (open) {
        const deletable = open.backups.filter((backup) => !backup.file.locked);
        content = (
            <div className="space-y-4">
                <FolderHead
                    folder={open}
                    destination={destination}
                    // On the timeline a second click on the job closes the folder instead.
                    onBack={display === "table" ? () => onFolder(null) : undefined}
                    onOpenJob={onOpenJob}
                    onDeleteAll={canDelete
                        ? () => askDelete(
                            deletable.map((backup) => ({ file: backup.file, destinationId: destination.id })),
                            `Delete ${count(deletable.length, "backup")} of a deleted job?`
                        )
                        : undefined}
                />
                {tableFor(folderRows, false, day !== null ? <DayChip day={day} count={folderRows.length} onClear={() => setPicked(null)} /> : undefined)}
            </div>
        );
    } else if (display === "table") {
        // Below the timeline the list waits for a job to be clicked, since the lanes show the same backups.
        content = layout === "all"
            ? tableFor(backups, true, layoutSwitch)
            : <FolderList folders={folders} destination={destination} destinations={destinations} onFolder={onFolder} toolbarExtra={layoutSwitch} />;
    }

    return (
        <div className="space-y-4 md:space-y-6">
            <ExplorerStrip
                cells={[
                    { label: "Stored", value: sizeValue, unit: sizeUnit, extra: `in ${count(backups.length, "backup")}` },
                    {
                        label: "Backups",
                        value: backups.length.toLocaleString(),
                        extra: `from ${count(activeJobs, "job")}${deletedJobs > 0 ? ` and ${count(deletedJobs, "deleted job")}` : ""}`,
                    },
                    {
                        label: "Newest",
                        value: newest ? <RelativeTime date={madeAt(newest.file)} /> : "-",
                        extra: newest ? jobs.get(newest.jobKey)?.name ?? newest.file.name : undefined,
                    },
                    { label: "Locked", value: locked.toLocaleString(), extra: "kept past retention" },
                    {
                        label: "Integrity",
                        value: failed > 0 ? failed.toLocaleString() : checked.toLocaleString(),
                        unit: failed > 0 ? "failed" : `of ${backups.length.toLocaleString()} checked`,
                        tone: failed > 0 ? "destructive" : undefined,
                        extra: failed > 0 ? `${checked.toLocaleString()} of ${backups.length.toLocaleString()} checked` : undefined,
                    },
                ]}
            />

            {display === "timeline" && (
                <BackupTimeline
                    title="Timeline"
                    hint={!open
                        ? "click a day to list its backups, a job to open its folder"
                        : day === null ? "click the job again to close its folder" : "click the day again to hide the list"}
                    lanes={lanes}
                    selectedLane={open?.key ?? null}
                    selectedDay={open && day !== null ? { lane: open.key, day } : null}
                    markedPointId={openPath}
                    onLaneClick={(key) => {
                        setPicked(null);
                        if (open?.key === key && day === null) onFolder(null);
                        else if (open?.key !== key) onFolder(key);
                    }}
                    onDayClick={(clicked) => {
                        if (open?.key === clicked.lane && day === clicked.day) {
                            setPicked(null);
                            onFolder(null);
                            return;
                        }
                        setPicked({ folder: clicked.lane, day: clicked.day });
                        if (open?.key !== clicked.lane) onFolder(clicked.lane);
                    }}
                />
            )}

            {content}
        </div>
    );
}
