"use client";

import { useId, useState } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { setUserPassword } from "@/app/actions/auth/user-security";
import { SwitchList, SwitchRow } from "@/components/adapter/setting-switches";
import { Button } from "@/components/ui/button";
import { DIALOG_FOOTER, DIALOG_SURFACE, DialogHead, dialogNoteClass } from "@/components/ui/confirm-dialog";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { cn } from "@/lib/utils";
import type { UserRow } from "@/services/user/users-types";
import { hasPassword } from "./user-actions";
import { PasswordField } from "./user-password-field";

const log = logger.child({ component: "user-password-dialog" });

interface UserPasswordDialogProps {
    user: UserRow;
    onClose: () => void;
    onDone: () => void;
}

/**
 * Sets a new password for another user, like when they lost theirs. It signs them out everywhere
 * unless that is turned off, so the old password stops working at once. A user who signs in only
 * with SSO gets a password as a second way in.
 */
export function UserPasswordDialog({ user, onClose, onDone }: UserPasswordDialogProps) {
    const [password, setPassword] = useState("");
    const [signOut, setSignOut] = useState(true);
    const [problem, setProblem] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const fieldId = useId();
    const had = hasPassword(user);

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (password.length < 8) return setProblem("The password needs at least 8 characters.");
        setSaving(true);
        try {
            const result = await setUserPassword(user.id, { password, signOut });
            if (result.success) {
                const ended = result.data?.signedOut ?? 0;
                toast.success(ended > 0 ? `New password set, ${ended} ${ended === 1 ? "session" : "sessions"} ended` : "New password set");
                onDone();
                return;
            }
            toast.error(result.error || "The password could not be set.");
        } catch (error) {
            log.warn("Setting a password failed", { userId: user.id }, wrapError(error));
            toast.error("The password could not be set.");
        }
        setSaving(false);
    };

    return (
        <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
            <DialogContent tone="edit" showCloseButton={false} className={DIALOG_SURFACE}>
                <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
                    <DialogHead tone="edit" icon={KeyRound}>
                        <DialogTitle className="truncate text-base">{had ? `New password for ${user.name}` : `A password for ${user.name}`}</DialogTitle>
                        <DialogDescription className={dialogNoteClass("edit")}>
                            {had ? "The old one stops working" : "A second way in besides single sign-on"}
                        </DialogDescription>
                    </DialogHead>

                    <div className="space-y-5 p-5">
                        <div className="space-y-2">
                            <Label htmlFor={fieldId}>Password</Label>
                            <PasswordField
                                id={fieldId}
                                value={password}
                                onChange={(value) => {
                                    setPassword(value);
                                    setProblem(null);
                                }}
                                aria-invalid={problem ? true : undefined}
                                aria-describedby={`${fieldId}-hint`}
                            />
                            {problem ? (
                                <p id={`${fieldId}-hint`} className="text-sm text-destructive">{problem}</p>
                            ) : (
                                <p id={`${fieldId}-hint`} className="text-xs text-muted-foreground">
                                    Hand it to them. They change it under Profile after they sign in.
                                </p>
                            )}
                        </div>
                        {user.sessions > 0 && (
                            <SwitchList>
                                <SwitchRow
                                    title="Sign them out everywhere"
                                    description={`${user.sessions} ${user.sessions === 1 ? "browser signs" : "browsers sign"} in again, with the new password`}
                                    checked={signOut}
                                    onCheckedChange={setSignOut}
                                />
                            </SwitchList>
                        )}
                    </div>

                    <div className={cn(DIALOG_FOOTER, "flex items-center justify-end gap-2")}>
                        <DialogClose asChild>
                            <Button type="button" variant="ghost" disabled={saving}>Cancel</Button>
                        </DialogClose>
                        <Button type="submit" disabled={saving}>
                            {saving && <Loader2 className="animate-spin" />}
                            Set password
                        </Button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    );
}
