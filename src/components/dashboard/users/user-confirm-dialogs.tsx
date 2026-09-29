"use client";

import { useState } from "react";
import { LogOut, ShieldOff, Trash } from "lucide-react";
import { toast } from "sonner";
import { deleteUser } from "@/app/actions/auth/user";
import { resetUserTwoFactor, revokeUserSessions } from "@/app/actions/auth/user-security";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
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

function askFor(kind: UserConfirmKind, user: UserRow): Ask {
    switch (kind) {
        case "delete":
            return {
                title: `Delete ${user.name}?`,
                note: "Cannot be undone",
                description: [
                    "Their sessions end at once",
                    user.apiKeys > 0 ? `and their ${count(user.apiKeys, "API key stops", "API keys stop")} working` : null,
                ].filter(Boolean).join(" ") + ". The audit log keeps what they did.",
                confirm: "Delete user",
                icon: Trash,
                run: () => deleteUser(user.id),
                done: `${user.name} deleted`,
            };
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
}

/** Asks before a user is deleted, loses the second factor or is signed out. Each is red, since each takes something away. */
export function UserConfirmDialog({ kind, user, onClose, onDone }: UserConfirmDialogProps) {
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
