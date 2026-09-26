"use client";

import { useId } from "react";
import { OctagonPause, TriangleAlert, Unlink } from "lucide-react";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { cn, formatBytes } from "@/lib/utils";
import { groupText, shortName, type PlanGroup } from "./volume-picker-model";

interface VolumePlanProps {
    groups: PlanGroup[];
    summary: string;
    /** Whether the containers of the volumes added here stop while they are read. */
    stopNew: boolean;
    onStopNewChange: (stop: boolean) => void;
    newCount: number;
    sizeOf: (name: string) => number | undefined;
}

/**
 * What the job reads in which order and which containers stop for it, beside the list. The switch
 * sits on top, so it stays in view however many volumes are picked.
 */
export function VolumePlan({ groups, summary, stopNew, onStopNewChange, newCount, sizeOf }: VolumePlanProps) {
    const id = useId();
    const volumes = newCount === 1 ? "the new volume" : newCount > 1 ? `the ${newCount} new volumes` : "the volumes you add here";

    return (
        <aside aria-label="What the job reads" className="flex max-h-[45%] min-h-0 flex-col border-t bg-page/40 lg:max-h-none lg:w-96 lg:shrink-0 lg:border-t-0 lg:border-l">
            <div className="border-b p-4">
                <div className="flex items-start gap-3 rounded-lg border bg-card p-3">
                    <div className="grid min-w-0 flex-1 gap-1">
                        <Label htmlFor={id}>Stop containers while reading</Label>
                        <p className="text-xs text-muted-foreground">For {volumes}. The ones already in the job keep their own setting, in their row.</p>
                    </div>
                    <Switch id={id} checked={stopNew} onCheckedChange={onStopNewChange} disabled={newCount === 0} />
                </div>
            </div>
            <div className="px-4 pt-3">
                <h3 className="text-sm font-semibold">What the job reads</h3>
                <p className="text-xs text-muted-foreground">One group at a time, each starts again as soon as it is read</p>
            </div>
            <ScrollArea className="min-h-0 flex-1">
                {groups.length === 0 ? (
                    <p className="p-4 text-sm text-muted-foreground">Tick volumes to see what the job reads and which containers stop.</p>
                ) : (
                    <ol className="grid gap-2 p-4">
                        {groups.map((group, index) => {
                            const warn = group.live && group.running.length > 0;
                            const Icon = warn ? TriangleAlert : group.running.length + group.stopped.length === 0 ? Unlink : OctagonPause;
                            return (
                                <li key={group.volumes.map((volume) => volume.name).join("\0")} className="flex gap-3 rounded-lg border bg-card p-3">
                                    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold tabular-nums">{index + 1}</span>
                                    <div className="min-w-0 flex-1">
                                        <ul className="grid gap-1">
                                            {group.volumes.map((volume) => {
                                                const size = sizeOf(volume.name);
                                                return (
                                                    <li key={volume.name} className="flex min-w-0 items-center gap-2">
                                                        <span className={cn("truncate font-medium", volume.anonymous ? "font-mono text-xs" : "text-sm")}>{shortName(volume)}</span>
                                                        {volume.isNew && <span className="shrink-0 rounded-sm bg-tone/10 px-1.5 py-0.5 text-[11px] font-medium text-tone">New</span>}
                                                        {size !== undefined && <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">{formatBytes(size, 1)}</span>}
                                                    </li>
                                                );
                                            })}
                                        </ul>
                                        <p className={cn("mt-1.5 flex items-start gap-1.5 text-xs", warn ? "text-warning" : "text-muted-foreground")}>
                                            <Icon className="mt-px size-3.5 shrink-0" aria-hidden="true" />
                                            {groupText(group)}
                                        </p>
                                    </div>
                                </li>
                            );
                        })}
                    </ol>
                )}
            </ScrollArea>
            {groups.length > 0 && <p className="border-t px-4 py-2.5 text-xs text-muted-foreground">{summary}</p>}
        </aside>
    );
}
