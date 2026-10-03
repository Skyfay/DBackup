import type * as React from "react";
import { CirclePause, CirclePlay, Copy, FolderOpen, History, Pencil, Play, Trash, Webhook } from "lucide-react";
import type { Tone } from "@/components/ui/tone";

export interface JobAction {
    id: string;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    onSelect: () => void;
    disabled?: boolean;
    /** The task of the dialog the action opens, which colors its entry in the menus. */
    tone: Tone;
}

/** Actions that belong together, under a heading in the menus that show one. */
export interface JobActionGroup {
    label?: string;
    actions: JobAction[];
}

export interface JobActionHandlers {
    onRun?: () => void;
    onOpenLastRun?: () => void;
    /** One entry per destination, like "Backups on NAS". */
    backups?: { label: string; onSelect: () => void }[];
    onApiTrigger?: () => void;
    onEdit?: () => void;
    onClone?: () => void;
    /** Pause for a job that runs on its schedule, Resume for a paused one. */
    toggle?: { paused: boolean; onSelect: () => void };
    onDelete?: () => void;
    /** A run is being started, or a clone of this job created. */
    busy?: boolean;
}

/**
 * Everything one job can do, as data.
 *
 * The button at the end of the row, the right click menu and the menu of the details render the
 * same list, so they can never drift apart. Actions the user may not take have no handler and
 * are left out.
 */
export function jobActions({ onRun, onOpenLastRun, backups = [], onApiTrigger, onEdit, onClone, toggle, onDelete, busy = false }: JobActionHandlers): JobActionGroup[] {
    const run: JobAction[] = [
        ...(onRun ? [{ id: "run", label: "Run now", icon: Play, onSelect: onRun, disabled: busy, tone: "neutral" as const }] : []),
        ...(onOpenLastRun ? [{ id: "last-run", label: "Open the last run", icon: History, onSelect: onOpenLastRun, tone: "neutral" as const }] : []),
        ...backups.map((entry, index) => ({ id: `backups-${index}`, label: entry.label, icon: FolderOpen, onSelect: entry.onSelect, tone: "neutral" as const })),
        ...(onApiTrigger ? [{ id: "api", label: "Trigger by API", icon: Webhook, onSelect: onApiTrigger, tone: "neutral" as const }] : []),
    ];
    const manage: JobAction[] = [
        ...(onEdit ? [{ id: "edit", label: "Edit", icon: Pencil, onSelect: onEdit, tone: "edit" as const }] : []),
        // A clone adds a new job, so it has the blue of adding.
        ...(onClone ? [{ id: "clone", label: "Clone", icon: Copy, onSelect: onClone, disabled: busy, tone: "create" as const }] : []),
        ...(toggle
            ? [{ id: "toggle", label: toggle.paused ? "Resume" : "Pause", icon: toggle.paused ? CirclePlay : CirclePause, onSelect: toggle.onSelect, tone: "neutral" as const }]
            : []),
    ];
    const remove: JobAction[] = onDelete ? [{ id: "delete", label: "Delete", icon: Trash, onSelect: onDelete, tone: "destructive" as const }] : [];

    return [
        ...(run.length > 0 ? [{ label: "Run", actions: run }] : []),
        ...(manage.length > 0 ? [{ label: "Manage", actions: manage }] : []),
        ...(remove.length > 0 ? [{ actions: remove }] : []),
    ];
}
