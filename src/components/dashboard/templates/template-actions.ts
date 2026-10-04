import { Copy, Pencil, Star, StarOff, Trash } from "lucide-react";
import type { BackupActionGroup } from "@/components/dashboard/storage/explorer/backup-actions";

export interface TemplateActionHandlers<T> {
    onEdit?: (row: T) => void;
    /** Makes the template the default. */
    onDefault?: (row: T) => void;
    /** Stops a default, for the kinds where a default only fills in new jobs and folders. */
    onUndefault?: (row: T) => void;
    onDuplicate?: (row: T) => void;
    onDelete?: (row: T) => void;
}

interface ActionOptions {
    isDefault: boolean;
    /** Whether the template can be edited at all, a built-in file name cannot. */
    editable?: boolean;
    /** Like "Make default", or "Default for new jobs". */
    defaultLabel?: string;
    /** The tone of the dialog Make default opens, neutral when it opens none. */
    defaultTone?: "warning" | "neutral";
    /** The details show Edit and the default as buttons of their own. */
    inPanel?: boolean;
}

/**
 * Everything one template can do, as data, for the button at the end of its row, the right click
 * menu and its details. Actions the viewer may not take have no handler and are left out.
 */
export function templateActions<T>(row: T, handlers: TemplateActionHandlers<T>, options: ActionOptions): BackupActionGroup[] {
    const { onEdit, onDefault, onUndefault, onDuplicate, onDelete } = handlers;
    const { isDefault, editable = true, defaultLabel = "Make default", defaultTone = "neutral", inPanel = false } = options;
    const manage = [
        ...(onEdit && editable && !inPanel ? [{ id: "edit", label: "Edit", icon: Pencil, onSelect: () => onEdit(row), tone: "edit" as const }] : []),
        ...(onDefault && !isDefault && !inPanel ? [{ id: "default", label: defaultLabel, icon: Star, onSelect: () => onDefault(row), tone: defaultTone }] : []),
        ...(onUndefault && isDefault ? [{ id: "undefault", label: "Stop as default", icon: StarOff, onSelect: () => onUndefault(row), tone: "neutral" as const }] : []),
        ...(onDuplicate ? [{ id: "duplicate", label: "Duplicate", icon: Copy, onSelect: () => onDuplicate(row), tone: "create" as const }] : []),
    ];
    const remove = onDelete ? [{ id: "delete", label: "Delete", icon: Trash, onSelect: () => onDelete(row), tone: "destructive" as const }] : [];
    return [...(manage.length > 0 ? [{ label: "Manage", actions: manage }] : []), ...(remove.length > 0 ? [{ actions: remove }] : [])];
}
