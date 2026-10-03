import { Pencil, Power, PowerOff, Trash } from "lucide-react";
import type { BackupActionGroup } from "@/components/dashboard/storage/explorer/backup-actions";
import type { SsoProviderRow } from "@/services/sso/sso-providers-types";

export interface SignInActionHandlers {
    onEdit?: (provider: SsoProviderRow) => void;
    onToggle?: (provider: SsoProviderRow) => void;
    onDelete?: (provider: SsoProviderRow) => void;
}

/**
 * Everything one provider can have done to it, as data, for the button at the end of its row, the
 * right click menu, the cards and the panel. Someone who may only look gets no handlers and no
 * menu. The panel shows Edit as a button of its own, so `inPanel` leaves it out.
 */
export function signInActions(provider: SsoProviderRow, handlers: SignInActionHandlers, inPanel = false): BackupActionGroup[] {
    const { onEdit, onToggle, onDelete } = handlers;
    const edit = !inPanel && onEdit ? [{ id: "edit", label: "Edit", icon: Pencil, onSelect: () => onEdit(provider), tone: "edit" as const }] : [];
    const state = onToggle
        ? [{
              id: "toggle",
              label: provider.enabled ? "Disable" : "Enable",
              icon: provider.enabled ? PowerOff : Power,
              onSelect: () => onToggle(provider),
              tone: "neutral" as const,
          }]
        : [];
    const remove = onDelete ? [{ id: "delete", label: "Delete", icon: Trash, onSelect: () => onDelete(provider), tone: "destructive" as const }] : [];
    return [
        ...(edit.length > 0 ? [{ label: "Manage", actions: edit }] : []),
        ...(state.length > 0 ? [{ actions: state }] : []),
        ...(remove.length > 0 ? [{ actions: remove }] : []),
    ];
}
