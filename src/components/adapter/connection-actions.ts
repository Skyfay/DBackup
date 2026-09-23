import type * as React from "react";
import { ArrowLeftRight, BarChart3, Copy, Pencil, SearchCode, Trash } from "lucide-react";

export interface ConnectionAction {
    id: string;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    onSelect: () => void;
    disabled?: boolean;
    destructive?: boolean;
}

/** Actions that belong together, under a heading in the menus that show one. */
export interface ConnectionActionGroup {
    label?: string;
    actions: ConnectionAction[];
}

export interface ConnectionActionHandlers {
    onExplore?: () => void;
    onHistory?: () => void;
    onEdit?: () => void;
    onClone?: () => void;
    /** Creates the same connection in the other storage role, where the adapter supports it. */
    counterpart?: { label: string; onSelect: () => void };
    onDelete?: () => void;
    /** A clone of this row is being created. */
    busy?: boolean;
}

/**
 * Everything one connection can do, as data.
 *
 * The button at the end of the row and the right click menu render the same list, so the two
 * can never drift apart. Actions the user may not take have no handler and are left out.
 */
export function connectionActions({
    onExplore,
    onHistory,
    onEdit,
    onClone,
    counterpart,
    onDelete,
    busy = false,
}: ConnectionActionHandlers): ConnectionActionGroup[] {
    const inspect: ConnectionAction[] = [
        ...(onExplore ? [{ id: "explore", label: "Explore databases", icon: SearchCode, onSelect: onExplore }] : []),
        ...(onHistory ? [{ id: "history", label: "Storage history", icon: BarChart3, onSelect: onHistory }] : []),
    ];
    const manage: ConnectionAction[] = [
        ...(onEdit ? [{ id: "edit", label: "Edit", icon: Pencil, onSelect: onEdit }] : []),
        ...(onClone ? [{ id: "clone", label: "Clone", icon: Copy, onSelect: onClone, disabled: busy }] : []),
        ...(counterpart
            ? [{ id: "counterpart", label: counterpart.label, icon: ArrowLeftRight, onSelect: counterpart.onSelect, disabled: busy }]
            : []),
    ];
    const remove: ConnectionAction[] = onDelete
        ? [{ id: "delete", label: "Delete", icon: Trash, onSelect: onDelete, destructive: true }]
        : [];

    return [
        ...(inspect.length > 0 ? [{ label: "Inspect", actions: inspect }] : []),
        ...(manage.length > 0 ? [{ label: "Manage", actions: manage }] : []),
        ...(remove.length > 0 ? [{ actions: remove }] : []),
    ];
}
