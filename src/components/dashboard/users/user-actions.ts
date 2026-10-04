import { KeyRound, LogOut, Pencil, ShieldOff, Trash } from "lucide-react";
import type { BackupActionGroup } from "@/components/dashboard/storage/explorer/backup-actions";
import type { UserRow } from "@/services/user/users-types";

export interface UserActionHandlers {
    onEdit?: (user: UserRow) => void;
    onPassword?: (user: UserRow) => void;
    onResetTwoFactor?: (user: UserRow) => void;
    onSignOut?: (user: UserRow) => void;
    onDelete?: (user: UserRow) => void;
}

export const hasPassword = (user: Pick<UserRow, "methods">) => user.methods.some((method) => method.kind === "password");

/** "Sign out everywhere", or for the viewer's own account every session but this one. */
export const signOutLabel = (user: Pick<UserRow, "isYou">) => (user.isYou ? "Sign out other sessions" : "Sign out everywhere");

/**
 * Everything one user can have done to them, as data, for the button at the end of the row, the
 * right click menu and the panel. Actions the viewer may not take have no handler and are left
 * out, and so is what makes no sense for the user: a password or a delete of the own account, or
 * a reset of a second factor they do not have. The panel shows Edit as a button of its own, so
 * `inPanel` leaves it out.
 */
export function userActions(user: UserRow, handlers: UserActionHandlers, inPanel = false): BackupActionGroup[] {
    const { onEdit, onPassword, onResetTwoFactor, onSignOut, onDelete } = handlers;
    const manage = onEdit && !inPanel ? [{ id: "edit", label: "Edit", icon: Pencil, onSelect: () => onEdit(user), tone: "edit" as const }] : [];
    const signIn = [
        ...(onPassword && !user.isYou
            ? [{ id: "password", label: hasPassword(user) ? "Set a new password" : "Set a password", icon: KeyRound, onSelect: () => onPassword(user), tone: "edit" as const }]
            : []),
        ...(onResetTwoFactor && (user.secondFactor === "app" || user.secondFactor === "passkey")
            ? [{ id: "reset-2fa", label: "Reset 2FA", icon: ShieldOff, onSelect: () => onResetTwoFactor(user), tone: "destructive" as const }]
            : []),
        ...(onSignOut && user.sessions > (user.isYou ? 1 : 0)
            ? [{ id: "sign-out", label: signOutLabel(user), icon: LogOut, onSelect: () => onSignOut(user), tone: "destructive" as const }]
            : []),
    ];
    const remove = onDelete && !user.isYou ? [{ id: "delete", label: "Delete", icon: Trash, onSelect: () => onDelete(user), tone: "destructive" as const }] : [];
    return [
        ...(manage.length > 0 ? [{ label: "Manage", actions: manage }] : []),
        ...(signIn.length > 0 ? [{ label: "Sign-in", actions: signIn }] : []),
        ...(remove.length > 0 ? [{ actions: remove }] : []),
    ];
}
