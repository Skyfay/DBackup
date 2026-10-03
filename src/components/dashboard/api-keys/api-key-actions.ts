import { Pencil, Power, PowerOff, RefreshCw, Trash } from "lucide-react";
import type { BackupActionGroup } from "@/components/dashboard/storage/explorer/backup-actions";
import type { ApiKeyRow } from "@/services/auth/api-keys-types";

export interface ApiKeyActionHandlers {
    onEdit?: (key: ApiKeyRow) => void;
    onRotate?: (key: ApiKeyRow) => void;
    onToggle?: (key: ApiKeyRow) => void;
    onDelete?: (key: ApiKeyRow) => void;
}

/**
 * Everything one key can have done to it, as data, for the button at the end of its row, the
 * right click menu, the cards and the panel. Actions the viewer may not take have no handler and
 * are left out. The panel shows Edit and Rotate as buttons of their own, so `inPanel` leaves them out.
 */
export function apiKeyActions(key: ApiKeyRow, handlers: ApiKeyActionHandlers, inPanel = false): BackupActionGroup[] {
    const { onEdit, onRotate, onToggle, onDelete } = handlers;
    const manage = inPanel
        ? []
        : [
              ...(onEdit ? [{ id: "edit", label: "Edit", icon: Pencil, onSelect: () => onEdit(key), tone: "edit" as const }] : []),
              ...(onRotate ? [{ id: "rotate", label: "Rotate", icon: RefreshCw, onSelect: () => onRotate(key), tone: "warning" as const }] : []),
          ];
    const state = onToggle && key.state !== "expired"
        ? [{
              id: "toggle",
              label: key.state === "disabled" ? "Enable" : "Disable",
              icon: key.state === "disabled" ? Power : PowerOff,
              onSelect: () => onToggle(key),
              tone: "neutral" as const,
          }]
        : [];
    const remove = onDelete ? [{ id: "delete", label: "Delete", icon: Trash, onSelect: () => onDelete(key), tone: "destructive" as const }] : [];
    return [
        ...(manage.length > 0 ? [{ label: "Manage", actions: manage }] : []),
        ...(state.length > 0 ? [{ actions: state }] : []),
        ...(remove.length > 0 ? [{ actions: remove }] : []),
    ];
}
