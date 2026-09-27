import { Eye, KeyRound, Pencil, Trash } from "lucide-react";
import type { BackupActionGroup } from "@/components/dashboard/storage/explorer/backup-actions";
import type { VaultCredential } from "@/services/vault/vault-types";

export interface CredentialActionHandlers {
    onPublicKey?: (profile: VaultCredential) => void;
    onReveal?: (profile: VaultCredential) => void;
    onEdit?: (profile: VaultCredential) => void;
    onDelete?: (profile: VaultCredential) => void;
}

/**
 * Everything one credential profile can do, as data, for the button at the end of its row, the
 * right click menu and its details. Actions the viewer may not take have no handler and are left
 * out. The details show Edit and Reveal as buttons of their own, so `inPanel` leaves them out.
 */
export function credentialActions(profile: VaultCredential, handlers: CredentialActionHandlers, inPanel = false): BackupActionGroup[] {
    const { onPublicKey, onReveal, onEdit, onDelete } = handlers;
    const inspect = [
        ...(onPublicKey && profile.publicKey ? [{ id: "public-key", label: "Public key", icon: KeyRound, onSelect: () => onPublicKey(profile), tone: "neutral" as const }] : []),
        ...(onReveal && !inPanel ? [{ id: "reveal", label: "Reveal secret", icon: Eye, onSelect: () => onReveal(profile), tone: "warning" as const }] : []),
    ];
    const manage = onEdit && !inPanel ? [{ id: "edit", label: "Edit", icon: Pencil, onSelect: () => onEdit(profile), tone: "edit" as const }] : [];
    const remove = onDelete ? [{ id: "delete", label: "Delete", icon: Trash, onSelect: () => onDelete(profile), tone: "destructive" as const }] : [];
    return [
        ...(inspect.length > 0 ? [{ label: "Inspect", actions: inspect }] : []),
        ...(manage.length > 0 ? [{ label: "Manage", actions: manage }] : []),
        ...(remove.length > 0 ? [{ actions: remove }] : []),
    ];
}
