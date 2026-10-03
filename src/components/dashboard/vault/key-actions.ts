import { Download, Eye, Pencil, Trash } from "lucide-react";
import type { BackupActionGroup } from "@/components/dashboard/storage/explorer/backup-actions";
import type { VaultKey } from "@/services/vault/vault-types";

export interface KeyActionHandlers {
    onKit?: (key: VaultKey) => void;
    onReveal?: (key: VaultKey) => void;
    onEdit?: (key: VaultKey) => void;
    onDelete?: (key: VaultKey) => void;
}

/**
 * Everything one encryption key can do, as data, for the button at the end of its row, the right
 * click menu and its details. Actions the viewer may not take have no handler and are left out.
 * The details show the kit, the reveal and Edit as buttons of their own, so `inPanel` leaves them out.
 */
export function keyActions(key: VaultKey, handlers: KeyActionHandlers, inPanel = false): BackupActionGroup[] {
    const { onKit, onReveal, onEdit, onDelete } = handlers;
    const keep = inPanel ? [] : [
        ...(onKit ? [{ id: "kit", label: "Recovery kit", icon: Download, onSelect: () => onKit(key), tone: "neutral" as const }] : []),
        ...(onReveal ? [{ id: "reveal", label: "Reveal key", icon: Eye, onSelect: () => onReveal(key), tone: "warning" as const }] : []),
    ];
    const manage = onEdit && !inPanel ? [{ id: "edit", label: "Edit", icon: Pencil, onSelect: () => onEdit(key), tone: "edit" as const }] : [];
    const remove = onDelete ? [{ id: "delete", label: "Delete", icon: Trash, onSelect: () => onDelete(key), tone: "destructive" as const }] : [];
    return [
        ...(keep.length > 0 ? [{ label: "Keep", actions: keep }] : []),
        ...(manage.length > 0 ? [{ label: "Manage", actions: manage }] : []),
        ...(remove.length > 0 ? [{ actions: remove }] : []),
    ];
}
