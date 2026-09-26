"use client";

import { useId } from "react";
import { ArrowRight, HardDrive, Hash, Layers, TriangleAlert, Unlink, type LucideIcon } from "lucide-react";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { Checkbox } from "@/components/ui/checkbox";
import { Highlight } from "@/components/ui/highlight";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import type { DockerVolumeEntry, DockerVolumeUser } from "@/lib/adapters/storage/docker/inventory";
import { cn, formatBytes } from "@/lib/utils";
import { matchesVolume, sectionMeta, shortName, type VolumeSection, type VolumeSectionKind } from "./volume-picker-model";

const SECTION_ICONS: Record<VolumeSectionKind, LucideIcon> = { missing: TriangleAlert, stack: Layers, plain: HardDrive, anonymous: Hash, unused: Unlink };

interface VolumeListProps {
    sections: VolumeSection[];
    term: string;
    picked: Set<string>;
    inJob: Set<string>;
    sizes: Record<string, number> | null;
    sizesLoading: boolean;
    onToggle: (names: string[], on: boolean) => void;
}

/**
 * The volumes of a Docker host by where they belong, each part with a checkbox for all of it.
 * Under a name stand the containers that mount it, whether they run and where they mount it, and
 * an anonymous volume goes by its container, since its own name says nothing.
 */
export function VolumeList({ sections, term, picked, inJob, sizes, sizesLoading, onToggle }: VolumeListProps) {
    const id = useId();
    const shown = sections
        .map((section) => ({ section, volumes: section.volumes.filter((volume) => matchesVolume(volume, term)) }))
        .filter((entry) => entry.volumes.length > 0);

    if (shown.length === 0) {
        return <p className="py-10 text-center text-sm text-muted-foreground">{term.trim() ? "No volume matches the filter." : "Docker on this host has no volumes yet."}</p>;
    }

    return (
        <div>
            {shown.map(({ section, volumes }) => {
                const names = volumes.map((volume) => volume.name);
                const count = names.filter((name) => picked.has(name)).length;
                const state = count === 0 ? false : count === names.length ? true : "indeterminate";
                const Icon = SECTION_ICONS[section.kind];
                const measured = sizes ? section.volumes.map((volume) => sizes[volume.name]).filter((size) => size !== undefined) : [];
                return (
                    <section key={section.key} aria-label={section.title}>
                        <div className="flex items-center gap-2.5 border-b bg-muted/40 px-4 py-2">
                            <Checkbox checked={state} onCheckedChange={() => onToggle(names, state !== true)} aria-label={`Pick every volume of ${section.title}`} />
                            <Icon className={cn("size-4 shrink-0", section.kind === "missing" ? "text-warning" : "text-muted-foreground")} aria-hidden="true" />
                            <span className={cn("shrink-0 text-sm font-semibold", section.kind === "unused" && "text-muted-foreground")}>{section.title}</span>
                            <span className="min-w-0 truncate text-xs text-muted-foreground">{sectionMeta(section, volumes.length)}</span>
                            {measured.length > 0 && <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">{formatBytes(measured.reduce((sum, size) => sum + size, 0), 1)}</span>}
                        </div>
                        <ul>
                            {volumes.map((volume, index) => {
                                const on = picked.has(volume.name);
                                const rowId = `${id}-${section.key}-${index}`;
                                return (
                                    <li key={volume.name}>
                                        <Label
                                            htmlFor={rowId}
                                            className={cn(
                                                "cursor-pointer gap-3 border-b py-2.5 pr-4 pl-10 font-normal hover:bg-muted/50",
                                                on && "bg-tone-control/5 hover:bg-tone-control/10 dark:bg-tone-control/10",
                                                section.kind === "unused" && !on && "text-muted-foreground",
                                            )}
                                        >
                                            <Checkbox id={rowId} checked={on} onCheckedChange={(checked) => onToggle([volume.name], checked === true)} />
                                            <span className="min-w-0 flex-1 leading-normal">
                                                <VolumeLines volume={volume} kind={section.kind} term={term} on={on} inJob={inJob.has(volume.name)} />
                                            </span>
                                            <span className="w-16 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                                                {sizes?.[volume.name] !== undefined ? (
                                                    formatBytes(sizes[volume.name], 1)
                                                ) : sizesLoading && section.kind !== "missing" ? (
                                                    <Skeleton className="ml-auto h-3 w-10" />
                                                ) : null}
                                            </span>
                                        </Label>
                                    </li>
                                );
                            })}
                        </ul>
                    </section>
                );
            })}
        </div>
    );
}

function VolumeLines({ volume, kind, term, on, inJob }: { volume: DockerVolumeEntry; kind: VolumeSectionKind; term: string; on: boolean; inJob: boolean }) {
    const tag = inJob && <span className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">In the job</span>;
    const [first] = volume.users;

    if (volume.anonymous && first) {
        const more = volume.users.length - 1;
        return (
            <>
                <span className="flex min-w-0 items-center gap-2 text-sm">
                    <StateDot running={first.running} />
                    <span className={cn("truncate", on && "font-medium")}>
                        <Highlight text={first.container} term={term} />
                        {more > 0 && <span className="text-muted-foreground"> +{more}</span>}
                    </span>
                    <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
                        <Highlight text={first.mount} term={term} />
                    </span>
                    {tag}
                </span>
                <span className="mt-1 block truncate font-mono text-xs text-muted-foreground">
                    {shortName(volume)} · <Highlight text={first.image} term={term} />
                </span>
            </>
        );
    }

    return (
        <>
            <span className="flex min-w-0 items-center gap-2">
                <span className={cn("truncate", volume.anonymous ? "font-mono text-xs" : "text-sm", on && "font-medium")}>
                    <Highlight text={volume.anonymous ? shortName(volume) : volume.name} term={term} />
                </span>
                {tag}
            </span>
            {kind === "missing" ? (
                <span className="mt-1 block text-xs text-warning">The host no longer has it. Untick it to take it out of the job.</span>
            ) : volume.users.length > 0 ? (
                <Users users={volume.users} term={term} />
            ) : (
                <span className="mt-1 block text-xs text-muted-foreground">
                    No container mounts it
                    {volume.createdAt && (
                        <>
                            {" · created "}
                            <RelativeTime date={volume.createdAt} />
                        </>
                    )}
                </span>
            )}
        </>
    );
}

/** The containers that mount a volume, with whether they run, and where they mount it. */
function Users({ users, term }: { users: DockerVolumeUser[]; term: string }) {
    const mounts = [...new Set(users.map((user) => user.mount))];
    return (
        <span className="mt-1 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            <span className="flex min-w-0 shrink items-center gap-1.5 truncate">
                {users.map((user, index) => (
                    <span key={user.container} className="inline-flex shrink-0 items-center gap-1.5">
                        <StateDot running={user.running} />
                        <span className="text-foreground">
                            <Highlight text={user.container} term={term} />
                        </span>
                        {!user.running && <span>stopped</span>}
                        {index < users.length - 1 && ","}
                    </span>
                ))}
            </span>
            <ArrowRight className="size-3 shrink-0" aria-hidden="true" />
            <span className="min-w-0 truncate font-mono">
                <Highlight text={mounts.join(", ")} term={term} />
            </span>
        </span>
    );
}

function StateDot({ running }: { running: boolean }) {
    return (
        <>
            <span className={cn("size-1.5 shrink-0 rounded-full", running ? "bg-success" : "border border-muted-foreground")} aria-hidden="true" />
            {running && <span className="sr-only">running,</span>}
        </>
    );
}
