"use client";

import { useState } from "react";
import { HardDrive, RotateCw } from "lucide-react";
import { FileBrowserFilter, FileBrowserFooter, HiddenToggle } from "@/components/system/file-browser-parts";
import { Button } from "@/components/ui/button";
import { DIALOG_SURFACE, DialogHead, dialogNoteClass } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, formatBytes } from "@/lib/utils";
import type { DirectoryTreeRow } from "./directory-tree";
import { useDockerVolumes } from "./use-docker-volumes";
import { VolumeList } from "./volume-picker-list";
import { matchesVolume, planGroups, planSummary, shortName, volumeSections, type PlanEntry } from "./volume-picker-model";
import { VolumePlan } from "./volume-picker-plan";

interface VolumePickerDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    configId: string;
    connectionName: string;
    /** Every volume of this connection the job has, with its own settings. */
    initialRows: DirectoryTreeRow[];
    onConfirm: (rows: DirectoryTreeRow[]) => void;
}

/**
 * Picks the volumes of a Docker connection for a job: the list by Compose project with the
 * containers of each volume, and beside it what the job reads in which order and what it stops.
 * Confirming hands back every volume of the connection, so one ticked off leaves the job.
 */
export function VolumePickerDialog(props: VolumePickerDialogProps) {
    return (
        <Dialog open={props.open} onOpenChange={props.onOpenChange}>
            <DialogContent tone="pick" showCloseButton={false} className={cn(DIALOG_SURFACE, "flex h-[min(90dvh,52rem)] flex-col sm:max-w-5xl lg:max-w-6xl")}>
                {/* Mounted per opening, so every visit starts from the rows of the job. */}
                {props.open && <PickerBody {...props} />}
            </DialogContent>
        </Dialog>
    );
}

function PickerBody({ onOpenChange, configId, connectionName, initialRows, onConfirm }: VolumePickerDialogProps) {
    const { listing, sizes, sizesLoading, reload } = useDockerVolumes(configId);
    const [picked, setPicked] = useState<string[]>(() => initialRows.map((row) => row.path));
    const [term, setTerm] = useState("");
    const [showUnused, setShowUnused] = useState(false);
    // Off for new volumes only when the job has them all off already.
    const [stopNew, setStopNew] = useState(() => !(initialRows.length > 0 && initialRows.every((row) => row.stopContainers === false)));

    const volumes = listing.status === "loaded" ? listing.volumes : [];
    const byName = new Map(volumes.map((volume) => [volume.name, volume]));
    const rows = new Map(initialRows.map((row) => [row.path, row]));
    const missing = listing.status === "loaded" ? initialRows.map((row) => row.path).filter((name) => !byName.has(name)) : [];
    const sections = volumeSections(volumes, missing);
    const unused = sections.find((section) => section.kind === "unused")?.volumes.length ?? 0;
    const filtering = term.trim() !== "";
    // A search looks through the ones not in use as well, since a name typed on purpose should be found.
    const shownSections = sections.filter((section) => section.kind !== "unused" || showUnused || filtering);
    const matches = volumes.filter((volume) => matchesVolume(volume, term)).length;

    const pickedSet = new Set(picked);
    // The rows of the job keep their order and their own setting, the new ones follow in the order they were ticked.
    const entries: PlanEntry[] = [
        ...initialRows.filter((row) => pickedSet.has(row.path)).map((row) => ({ name: row.path, isNew: false, stops: row.stopContainers !== false })),
        ...picked.filter((name) => !rows.has(name)).map((name) => ({ name, isNew: true, stops: stopNew })),
    ];
    const sizeOf = (name: string) => sizes?.[name];
    const groups = planGroups(entries, (name) => byName.get(name));
    const newCount = entries.filter((entry) => entry.isNew).length;

    const toggle = (names: string[], on: boolean) =>
        setPicked((current) => (on ? [...current, ...names.filter((name) => !current.includes(name))] : current.filter((name) => !names.includes(name))));

    const confirm = () => {
        onConfirm(entries.map((entry) => rows.get(entry.name) ?? { path: entry.name, excludePatterns: [], stopContainers: stopNew }));
        onOpenChange(false);
    };

    const note =
        listing.status === "loading" ? "Loading the volumes"
        : listing.status === "failed" ? "The volumes could not be loaded"
        : `${volumes.length} ${volumes.length === 1 ? "volume" : "volumes"}, ${volumes.filter((volume) => volume.users.length > 0).length} in use`;
    const names = entries.map((entry) => shortName(byName.get(entry.name) ?? { name: entry.name, anonymous: /^[0-9a-f]{64}$/.test(entry.name) }));

    return (
        <>
            <DialogHead tone="pick" icon={HardDrive} className="px-5 py-4">
                <DialogTitle className="truncate text-base">Pick volumes from {connectionName}</DialogTitle>
                <DialogDescription className={dialogNoteClass("pick")}>{note}</DialogDescription>
            </DialogHead>

            <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
                <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                    <div className="flex items-center gap-3 border-b px-4 py-3">
                        <div className="min-w-0 flex-1">
                            <FileBrowserFilter value={term} onChange={setTerm} label="Filter by volume, container, image or path" />
                        </div>
                        {filtering && listing.status === "loaded" && (
                            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                                {matches} of {volumes.length} match
                            </span>
                        )}
                        <Button type="button" variant="outline" size="icon" className="size-8 shrink-0" onClick={reload} aria-label="Load the volumes again">
                            <RotateCw className="size-3.5" />
                        </Button>
                    </div>
                    <ScrollArea className="min-h-0 flex-1">
                        {listing.status === "loading" ? (
                            <div className="grid gap-3 p-4" aria-busy="true" aria-label="Loading the volumes">
                                {["w-2/5", "w-1/3", "w-1/2", "w-1/4", "w-2/5"].map((width, index) => (
                                    <div key={index} className="flex items-center gap-3">
                                        <Skeleton className="size-4" />
                                        <Skeleton className={cn("h-3.5", width)} />
                                        <Skeleton className="ml-auto h-3 w-12" />
                                    </div>
                                ))}
                            </div>
                        ) : listing.status === "failed" ? (
                            <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
                                <p className="text-sm text-muted-foreground">{listing.message}</p>
                                <Button type="button" variant="outline" size="sm" onClick={reload}>
                                    <RotateCw />
                                    Try again
                                </Button>
                            </div>
                        ) : (
                            <VolumeList sections={shownSections} term={term} picked={pickedSet} inJob={new Set(rows.keys())} sizes={sizes} sizesLoading={sizesLoading} onToggle={toggle} />
                        )}
                    </ScrollArea>
                    <div className="flex min-h-10 items-center border-t px-2">
                        {!filtering && (
                            <HiddenToggle
                                count={unused}
                                shown={showUnused}
                                onToggle={() => setShowUnused((current) => !current)}
                                labels={{ show: `Show ${unused} not in use`, hide: "Hide the ones not in use" }}
                            />
                        )}
                    </div>
                </div>

                <VolumePlan
                    groups={groups}
                    summary={planSummary(groups, sizeOf, (bytes) => formatBytes(bytes, 1))}
                    stopNew={stopNew}
                    onStopNewChange={setStopNew}
                    newCount={newCount}
                    sizeOf={sizeOf}
                />
            </div>

            <FileBrowserFooter
                label={newCount > 0 ? `${entries.length} picked, ${newCount} new` : `${entries.length} picked`}
                chosen={names.length > 0 ? names.join(", ") : null}
                action={entries.length === 1 ? "Use this volume" : `Use ${entries.length} volumes`}
                disabled={listing.status !== "loaded"}
                onUse={confirm}
                cut="end"
            />
        </>
    );
}
