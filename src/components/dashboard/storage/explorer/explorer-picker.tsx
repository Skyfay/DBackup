"use client";

import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn, formatBytes } from "@/lib/utils";
import type { ExplorerDestination, ExplorerJob } from "@/services/storage/explorer-types";
import { count } from "./explorer-format";
import { DestinationTile, JobTile } from "./explorer-cells";

export type ExplorerMode = "jobs" | "destinations";

function jobMeta(job: ExplorerJob, destinations: Map<string, ExplorerDestination>): string {
    const where = job.destinationIds.map((id) => destinations.get(id)?.name).filter(Boolean).join(", ");
    const size = job.runs > 0 ? ` · ${formatBytes(job.size, 1)}` : "";
    if (job.kind === "deleted") return `${count(job.runs, "backup")} kept${size}${where ? ` · ${where}` : ""}`;
    if (job.kind !== "job") return `${count(job.runs, "file")}${size}${where ? ` · ${where}` : ""}`;
    if (job.runs === 0) return where ? `No backups yet · ${where}` : "No backups yet";
    return `${count(job.runs, "backup")}${size}${where ? ` · ${where}` : ""}`;
}

function destinationMeta(destination: ExplorerDestination): string {
    if (!destination.listedAt) return destination.listing ? "Listing" : destination.listError ? "Could not be listed" : "Not listed yet";
    return `${count(destination.count, "backup")} · ${formatBytes(destination.size, 1)}`;
}

interface ExplorerPickerProps {
    mode: ExplorerMode;
    jobs: ExplorerJob[];
    destinations: ExplorerDestination[];
    destinationsById: Map<string, ExplorerDestination>;
    /** The key of the picked job or the id of the picked destination. */
    value: string | null;
    onChange: (value: string) => void;
}

/**
 * Picks the job or the destination whose backups the page shows, with a search. Deleted jobs keep
 * a group of their own while their backups exist, so they stay easy to find and clean up.
 */
export function ExplorerPicker({ mode, jobs, destinations, destinationsById, value, onChange }: ExplorerPickerProps) {
    const [open, setOpen] = useState(false);
    const pickedJob = mode === "jobs" ? jobs.find((job) => job.key === value) ?? null : null;
    const pickedDestination = mode === "destinations" ? destinations.find((destination) => destination.id === value) ?? null : null;

    const pick = (next: string) => {
        onChange(next);
        setOpen(false);
    };

    const groups = mode === "jobs"
        ? [
            { heading: "Jobs", entries: jobs.filter((job) => job.kind === "job") },
            { heading: "Deleted jobs", entries: jobs.filter((job) => job.kind === "deleted") },
            { heading: "Not from a job", entries: jobs.filter((job) => job.kind === "system" || job.kind === "none") },
        ].filter((group) => group.entries.length > 0)
        : [];

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={open}
                    aria-label={mode === "jobs" ? "Pick a job" : "Pick a destination"}
                    className="h-9 w-full min-w-0 justify-between gap-2 px-3 md:w-104"
                >
                    <span className="flex min-w-0 items-center gap-2">
                        {pickedJob && <JobTile job={pickedJob} size="sm" />}
                        {pickedDestination && <DestinationTile destination={pickedDestination} size="sm" />}
                        <span className="truncate font-medium">
                            {pickedJob?.name ?? pickedDestination?.name ?? (mode === "jobs" ? "Pick a job" : "Pick a destination")}
                        </span>
                        <span className="hidden truncate font-normal text-muted-foreground sm:inline">
                            {pickedJob ? jobMeta(pickedJob, destinationsById) : pickedDestination ? destinationMeta(pickedDestination) : ""}
                        </span>
                    </span>
                    <ChevronsUpDown className="shrink-0 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-(--radix-popover-trigger-width) min-w-80 overflow-hidden rounded-xl bg-raised p-0 md:min-w-120" align="start">
                <Command>
                    <CommandInput placeholder={mode === "jobs" ? "Search jobs" : "Search destinations"} />
                    <CommandList>
                        <CommandEmpty>{mode === "jobs" ? "No job found." : "No destination found."}</CommandEmpty>
                        {mode === "jobs"
                            ? groups.map((group) => (
                                <CommandGroup key={group.heading} heading={group.heading}>
                                    {group.entries.map((job) => (
                                        <CommandItem key={job.key} value={`${job.name} ${job.key}`} onSelect={() => pick(job.key)} className="gap-3 py-2">
                                            <JobTile job={job} />
                                            <span className="min-w-0 flex-1">
                                                <span className={cn("block truncate font-medium", job.kind !== "job" && "text-muted-foreground")}>{job.name}</span>
                                                <span className="block truncate text-xs text-muted-foreground">{jobMeta(job, destinationsById)}</span>
                                            </span>
                                            {job.failedChecks > 0 && (
                                                <span className="flex shrink-0 items-center gap-1.5 text-xs text-destructive">
                                                    <span className="size-1.5 rounded-full bg-destructive" aria-hidden="true" />
                                                    {count(job.failedChecks, "failed check")}
                                                </span>
                                            )}
                                            <Check className={cn("shrink-0", job.key === value ? "opacity-100" : "opacity-0")} />
                                        </CommandItem>
                                    ))}
                                </CommandGroup>
                            ))
                            : (
                                <CommandGroup heading="Destinations">
                                    {destinations.map((destination) => (
                                        <CommandItem key={destination.id} value={`${destination.name} ${destination.id}`} onSelect={() => pick(destination.id)} className="gap-3 py-2">
                                            <DestinationTile destination={destination} />
                                            <span className="min-w-0 flex-1">
                                                <span className="block truncate font-medium">{destination.name}</span>
                                                <span className="block truncate text-xs text-muted-foreground">{destinationMeta(destination)}</span>
                                            </span>
                                            <Check className={cn("shrink-0", destination.id === value ? "opacity-100" : "opacity-0")} />
                                        </CommandItem>
                                    ))}
                                </CommandGroup>
                            )}
                    </CommandList>
                    {mode === "jobs" && (
                        <p className="border-t bg-page/60 px-3 py-2 text-xs text-muted-foreground">
                            A deleted job stays in this list while any of its backups exist.
                        </p>
                    )}
                </Command>
            </PopoverContent>
        </Popover>
    );
}
