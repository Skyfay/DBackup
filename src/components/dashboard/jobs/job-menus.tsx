"use client";

import * as React from "react";
import { CalendarClock, Loader2, MoreHorizontal, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ContextMenuContent, ContextMenuItem, ContextMenuLabel, ContextMenuSeparator } from "@/components/ui/context-menu";
import type { RowMenuBulk } from "@/components/ui/data-table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { RowMenuHead, SelectionMenu } from "@/components/ui/row-menu";
import { cn } from "@/lib/utils";
import type { JobListItem } from "@/services/jobs/job-list-service";
import { jobActions, type JobActionHandlers } from "./job-actions";
import { describeSchedule } from "./job-schedule";

interface JobRowActionsProps extends JobActionHandlers {
    name: string;
    /** Starting a run is also a button of its own, beside the menu. */
    showRun?: boolean;
    starting?: boolean;
}

/**
 * The end of a row: Run now, shown on hover from md up, and everything else behind one button.
 * The menu renders `jobActions`, the same list the right click menu shows.
 */
export function JobRowActions({ name, showRun = true, starting = false, ...handlers }: JobRowActionsProps) {
    const groups = jobActions(handlers);
    return (
        <div className="flex items-center gap-0.5">
            {showRun && handlers.onRun && (
                <Button
                    variant="ghost"
                    className={cn(
                        "size-8 p-0 text-muted-foreground hover:text-foreground",
                        // Touch screens have no hover, so the button stays visible below md.
                        !starting && "md:opacity-0 md:group-hover/row:opacity-100 md:focus-visible:opacity-100"
                    )}
                    disabled={handlers.busy}
                    onClick={handlers.onRun}
                    aria-label={`Run ${name} now`}
                    title="Run now"
                >
                    {starting ? <Loader2 className="animate-spin" /> : <Play />}
                </Button>
            )}
            {groups.length > 0 && (
                // Not modal, so a dialog opened from an item gets focus and pointer events back cleanly.
                <DropdownMenu modal={false}>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" className="size-8 p-0">
                            <MoreHorizontal />
                            <span className="sr-only">Open menu for {name}</span>
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                        {groups.map((group, index) => (
                            <React.Fragment key={group.label ?? "actions"}>
                                {index > 0 && <DropdownMenuSeparator />}
                                {group.actions.map((action) => (
                                    <DropdownMenuItem
                                        key={action.id}
                                        onSelect={action.onSelect}
                                        disabled={action.disabled}
                                        variant={action.tone === "destructive" ? "destructive" : "default"}
                                        tone={action.tone}
                                    >
                                        <action.icon /> {action.label}
                                    </DropdownMenuItem>
                                ))}
                            </React.Fragment>
                        ))}
                    </DropdownMenuContent>
                </DropdownMenu>
            )}
        </div>
    );
}

interface JobContextMenuProps extends JobActionHandlers {
    job: JobListItem;
    /** Set when the right clicked row is one of several selected rows. */
    bulk: RowMenuBulk<JobListItem> | null;
}

/** What a right click on a job offers: its own actions, or the ones for the whole selection. */
export function JobContextMenu({ job, bulk, ...handlers }: JobContextMenuProps) {
    const groups = jobActions(handlers);
    if (bulk) return <SelectionMenu bulk={bulk} />;
    if (groups.length === 0) return null;

    return (
        <ContextMenuContent className="w-56">
            <RowMenuHead
                tile={
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-card">
                        <CalendarClock className="size-4 text-muted-foreground" />
                    </span>
                }
                title={job.name}
                note={describeSchedule(job.schedulePreset?.schedule ?? job.schedule).text}
            />
            {groups.map((group, index) => (
                <React.Fragment key={group.label ?? "actions"}>
                    {group.label ? <ContextMenuLabel>{group.label}</ContextMenuLabel> : index > 0 && <ContextMenuSeparator />}
                    {group.actions.map((action) => (
                        <ContextMenuItem
                            key={action.id}
                            onSelect={action.onSelect}
                            disabled={action.disabled}
                            variant={action.tone === "destructive" ? "destructive" : "default"}
                            tone={action.tone}
                        >
                            <action.icon /> {action.label}
                        </ContextMenuItem>
                    ))}
                </React.Fragment>
            ))}
        </ContextMenuContent>
    );
}
