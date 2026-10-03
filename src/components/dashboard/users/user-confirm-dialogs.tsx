"use client";

import { useState } from "react";
import { LogOut, ShieldOff, Trash } from "lucide-react";
import { toast } from "sonner";
import { deleteUser } from "@/app/actions/auth/user";
import { resetUserTwoFactor, revokeUserSessions } from "@/app/actions/auth/user-security";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { TrashConfirmDialog, toastMovedToTrash, useTrashUntil } from "@/components/ui/delete-mode";
import { useTrash } from "@/components/trash/use-trash";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import type { UserRow } from "@/services/user/users-types";
import { signOutLabel } from "./user-actions";

const log = logger.child({ component: "user-confirm-dialogs" });

export type UserConfirmKind = "delete" | "reset-2fa" | "sign-out";

interface Ask {
    title: string;
    note: string;
    description: string;
    confirm: string;
    icon: React.ComponentType<{ className?: string }>;
    run: () => Promise<{ success: boolean; error?: string }>;
    done: string;
}

const count = (value: number, one: string, many: string) => `${value} ${value === 1 ? one : many}`;

function askFor(kind: Exclude<UserConfirmKind, "delete">, user: UserRow): Ask {
    switch (kind) {
        case "reset-2fa":
            return {
                title: `Reset 2FA of ${user.name}?`,
                note: "Their authenticator app or passkey no longer counts",
                description: "They sign in with the password alone until they set up a second factor again under Profile.",
                confirm: "Reset 2FA",
                icon: ShieldOff,
                run: () => resetUserTwoFactor(user.id),
                done: `2FA of ${user.name} reset`,
            };
        case "sign-out":
            return {
                title: user.isYou ? "Sign out your other sessions?" : `Sign out ${user.name} everywhere?`,
                note: user.isYou ? "This browser stays signed in" : "Every browser has to sign in again",
                description: user.isYou
                    ? "Every other browser you signed in with has to sign in again."
                    : `${count(user.sessions, "session ends", "sessions end")} at once. Their API keys keep working.`,
                confirm: signOutLabel(user),
                icon: LogOut,
                run: () => revokeUserSessions(user.id),
                done: user.isYou ? "Your other sessions ended" : `${user.name} is signed out`,
            };
    }
}

interface UserConfirmDialogProps {
    kind: UserConfirmKind;
    user: UserRow;
    onClose: () => void;
    onDone: () => void;
    /** After Undo brought a deleted user back, to load the list again. */
    onRestored: () => void | Promise<void>;
}

/**
 * Asks before a user is deleted, loses the second factor or is signed out. A delete goes to
 * Recently deleted in amber unless it is ticked to go at once, the rest is red, since each takes
 * something away.
 */
export function UserConfirmDialog({ kind, onRestored, ...props }: UserConfirmDialogProps) {
    return kind === "delete" ? <UserDeleteDialog {...props} onRestored={onRestored} /> : <UserAskDialog kind={kind} {...props} />;
}

function UserDeleteDialog({ user, onClose, onDone, onRestored }: Omit<UserConfirmDialogProps, "kind">) {
    const [pending, setPending] = useState(false);
    const trash = useTrash("user", onRestored);
    const until = useTrashUntil(trash.days);
    const keys = user.apiKeys > 0 ? " and API keys" : "";

    const remove = async (permanently: boolean) => {
        setPending(true);
        try {
            const result = await deleteUser(user.id, { permanently });
            if (result.success) {
                if (permanently) toast.success(`${user.name} deleted`);
                else toastMovedToTrash(`${user.name} moved to Recently deleted`, trash.days, () => trash.undo([user.id]));
                onDone();
                return;
            }
            toast.error(result.error || "That did not work.");
        } catch (error) {
            // Without the right to change users the action throws instead of answering.
            log.warn("Deleting a user failed", { userId: user.id }, wrapError(error));
            toast.error("That did not work.");
        }
        setPending(false);
    };

    return (
        <TrashConfirmDialog
            onOpenChange={(open) => !open && onClose()}
            icon={Trash}
            title={`Delete ${user.name}?`}
            note="They cannot sign in while deleted"
            description={[
                "Their sessions end at once",
                user.apiKeys > 0 ? `and their ${count(user.apiKeys, "API key stops", "API keys stop")} working` : null,
            ].filter(Boolean).join(" ") + ". The audit log keeps what they did."}
            confirmLabel="Delete user"
            days={trash.days}
            canDeletePermanently={trash.canDeletePermanently}
            subject={user.name}
            restoreLine={`Restore them until ${until} and they sign in as before, with their password, second factor, passkeys${keys}.`}
            permanentLine={`For an account that has to be gone at once. It skips Recently deleted with the password, second factor, passkeys${keys}.`}
            permanentNotice={`${user.name} is gone at once. DBackup keeps no copy of the account anywhere.`}
            isPending={pending}
            onConfirm={(permanently) => void remove(permanently)}
        />
    );
}

function UserAskDialog({ kind, user, onClose, onDone }: Omit<UserConfirmDialogProps, "kind" | "onRestored"> & { kind: Exclude<UserConfirmKind, "delete"> }) {
    const [pending, setPending] = useState(false);
    const ask = askFor(kind, user);

    const confirm = async () => {
        setPending(true);
        try {
            const result = await ask.run();
            if (result.success) {
                toast.success(ask.done);
                onDone();
                return;
            }
            toast.error(result.error || "That did not work.");
        } catch (error) {
            // Without the right to change users the actions throw instead of answering.
            log.warn("A user action failed", { kind, userId: user.id }, wrapError(error));
            toast.error("That did not work.");
        }
        setPending(false);
    };

    return (
        <ConfirmDialog
            open
            onOpenChange={(open) => !open && onClose()}
            title={ask.title}
            note={ask.note}
            description={ask.description}
            icon={ask.icon}
            confirmLabel={ask.confirm}
            destructive
            isPending={pending}
            onConfirm={confirm}
        />
    );
}
