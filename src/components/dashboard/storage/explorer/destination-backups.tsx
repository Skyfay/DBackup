"use client";

import { useMemo } from "react";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDateFormatter } from "@/hooks/use-date-formatter";
import { formatBytes } from "@/lib/utils";
import type { DestinationBackup, ExplorerDestination, ExplorerDestinationView, ExplorerFile, ExplorerJob } from "@/services/storage/explorer-types";
import type { BackupActionHandlers } from "./backup-actions";
import { BackupTimeline, type TimelineLane } from "./backup-timeline";
import { DestinationBackupTable } from "./destination-backup-table";
import { FolderHead, FolderList, FolderTile } from "./destination-folder-list";
import { foldersOf } from "./destination-folders";
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

function LayoutSwitch({ value, onChange }: { value: DestinationLayout; onChange: (next: DestinationLayout) => void }) {
    return (
        <Tabs value={value} onValueChange={(next) => onChange(next as DestinationLayout)}>
            <TabsList className="h-8" aria-label="Show the backups">
                <TabsTrigger value="folders" className="px-2.5 text-xs">Folders</TabsTrigger>
                <TabsTrigger value="all" className="px-2.5 text-xs">All backups</TabsTrigger>
            </TabsList>
        </Tabs>
    );
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
            // Another folder starts with its own filter and selection.
            key={open?.key ?? "all"}
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
    const layoutSwitch = <LayoutSwitch value={layout} onChange={onLayout} />;

    let content: React.ReactNode = null;
    if (open) {
        const deletable = open.backups.filter((backup) => !backup.file.locked);
        content = (
            <div className="space-y-4">
                <FolderHead
                    folder={open}
                    destination={destination}
                    onBack={() => onFolder(null)}
                    onOpenJob={onOpenJob}
                    onDeleteAll={canDelete
                        ? () => askDelete(
                            deletable.map((backup) => ({ file: backup.file, destinationId: destination.id })),
                            `Delete ${count(deletable.length, "backup")} of a deleted job?`
                        )
                        : undefined}
                />
                {tableFor(open.backups, false)}
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
                    hint={open ? "click the job again to close its folder" : "click a job to open its folder, a point to open a backup"}
                    lanes={lanes}
                    selectedLane={open?.key ?? null}
                    markedPointId={openPath}
                    onLaneClick={(key) => onFolder(open?.key === key ? null : key)}
                    onPointClick={(_lane, path) => {
                        const match = backups.find((backup) => backup.file.path === path);
                        if (match) onOpen(match);
                    }}
                />
            )}

            {content}
        </div>
    );
}
