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
 * Whether the viewer may rotate a key, enable it again and change what it may do, like `holdsKey`
 * on the server: its owner and a platform admin. Anyone else who may change API keys only
 * disables, deletes, renames or shortens it.
 */
export function mayChangeKey(key: Pick<ApiKeyRow, "isMine">, viewerIsPlatformAdmin: boolean): boolean {
    return key.isMine || viewerIsPlatformAdmin;
}

/** The handlers the viewer gets for a key: every one for a key they hold, for one of someone else only what takes access away. */
export function keyHandlers(key: Pick<ApiKeyRow, "isMine" | "state">, handlers: ApiKeyActionHandlers, viewerIsPlatformAdmin: boolean): ApiKeyActionHandlers {
    if (mayChangeKey(key, viewerIsPlatformAdmin)) return handlers;
    const { onEdit, onToggle, onDelete } = handlers;
    return { onEdit, onDelete, ...(key.state === "disabled" ? {} : { onToggle }) };
}

/** Why the viewer may not enable a key again, for a bulk action, null when they may. */
export function keyLockReason(key: Pick<ApiKeyRow, "isMine">, viewerIsPlatformAdmin: boolean): string | null {
    return mayChangeKey(key, viewerIsPlatformAdmin) ? null : "Only its owner or a platform admin enables it again";
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
