"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Eye, KeyRound, Trash } from "lucide-react";
import { toast } from "sonner";
import { AdapterIcon } from "@/components/adapter/adapter-icon";
import { CREDENTIAL_TYPE_INFO } from "@/components/settings/credential-types";
import { SshPublicKeyPanel } from "@/components/settings/ssh-public-key-panel";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, DIALOG_FOOTER, DIALOG_SURFACE, DialogHead, DialogItemList, dialogNoteClass } from "@/components/ui/confirm-dialog";
import { TrashConfirmDialog, toastMovedToTrash } from "@/components/ui/delete-mode";
import { useTrash } from "@/components/trash/use-trash";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { shortFingerprint } from "@/lib/core/credential-holds";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { cn } from "@/lib/utils";
import type { VaultCredential } from "@/services/vault/vault-types";
import { SecretField } from "./secret-field";
import { connectionHref, connectionKind, count } from "./vault-format";

const log = logger.child({ component: "credential-dialogs" });

/** Leaves room for the head and the foot on a short screen. */
const BODY_SCROLL = "min-h-0 flex-1 *:data-[slot=scroll-area-viewport]:max-h-[calc(95dvh-9.5rem)]";

/** The fields of a payload in the order people read them, with their names. Anything else follows as it is named. */
const FIELDS: [string, string, boolean][] = [
    ["username", "User", false],
    ["user", "User", false],
    ["authType", "Sign-in", false],
    ["password", "Password", true],
    ["accessKeyId", "Access key ID", true],
    ["secretAccessKey", "Secret access key", true],
    ["clientId", "Client ID", true],
    ["clientSecret", "Client secret", true],
    ["refreshToken", "Refresh token", true],
    ["token", "Token", true],
    ["url", "URL", true],
    ["authHeader", "Auth header", true],
    ["privateKey", "Private key", true],
    ["passphrase", "Passphrase", true],
];

const SIGN_IN: Record<string, string> = { password: "Password", privateKey: "Private key", agent: "SSH agent" };

/** The fields worth showing, the public key left out, since the details show it anyway. */
function fieldsOf(payload: Record<string, unknown>): { label: string; value: string; mono: boolean }[] {
    const known = new Map(FIELDS.map(([key, label, mono]) => [key, { label, mono }]));
    const keys = [...FIELDS.map(([key]) => key).filter((key) => key in payload), ...Object.keys(payload).filter((key) => !known.has(key) && key !== "publicKey")];
    return keys.flatMap((key) => {
        const raw = payload[key];
        if (raw === undefined || raw === null || raw === "") return [];
        const value = key === "authType" ? SIGN_IN[String(raw)] ?? String(raw) : typeof raw === "string" ? raw : JSON.stringify(raw);
        const field = known.get(key);
        return [{ label: field?.label ?? key, value, mono: field?.mono ?? true }];
    });
}

const capitalized = (text: string) => text[0].toUpperCase() + text.slice(1);

/**
 * Asks the server for the secret of a profile, which writes an entry to the audit log first. Null
 * when it was refused, which the toast explains. Called from a click, never from an effect, so a
 * reveal happens once per click.
 */
export async function revealSecret(profile: Pick<VaultCredential, "id">): Promise<Record<string, unknown> | null> {
    try {
        const response = await fetch(`/api/credentials/${profile.id}/reveal`);
        const body = await response.json().catch(() => null);
        if (response.ok && body?.success) return (body.data.payload ?? {}) as Record<string, unknown>;
        toast.error(body?.error || "The secret could not be revealed.");
    } catch (error) {
        log.error("Revealing a credential failed", { profileId: profile.id }, wrapError(error));
        toast.error("The secret could not be revealed.");
    }
    return null;
}

interface RevealSecretDialogProps {
    profile: VaultCredential;
    /** Null while the server answers. */
    payload: Record<string, unknown> | null;
    onClose: () => void;
}

/** The secret of a profile in the clear. */
export function RevealSecretDialog({ profile, payload, onClose }: RevealSecretDialogProps) {
    return (
        <Dialog open onOpenChange={(open) => !open && onClose()}>
            <DialogContent tone="warning" showCloseButton={false} className={DIALOG_SURFACE}>
                <DialogHead tone="warning" icon={Eye}>
                    <DialogTitle className="truncate text-base">{`${capitalized(CREDENTIAL_TYPE_INFO[profile.type].noun)} of ${profile.name}`}</DialogTitle>
                    <DialogDescription className={dialogNoteClass("warning")}>This was written to the audit log</DialogDescription>
                </DialogHead>
                <ScrollArea className={BODY_SCROLL}>
                    <div className="space-y-4 p-5">
                        {payload === null ? (
                            <div className="space-y-4" aria-busy="true">
                                <Skeleton className="h-14 w-full" />
                                <Skeleton className="h-14 w-full" />
                            </div>
                        ) : (
                            fieldsOf(payload).map((field) => <SecretField key={field.label} {...field} />)
                        )}
                        <p className="text-xs text-muted-foreground">Closing the dialog hides it again. Edit replaces it, it never shows in a form.</p>
                    </div>
                </ScrollArea>
                <div className={cn(DIALOG_FOOTER, "flex justify-end")}>
                    <DialogClose asChild>
                        <Button variant="outline">Close</Button>
                    </DialogClose>
                </div>
            </DialogContent>
        </Dialog>
    );
}

/** The public half of an SSH key, which is no secret, so it needs no reveal and no audit entry. */
export function PublicKeyDialog({ profile, onClose }: { profile: VaultCredential; onClose: () => void }) {
    return (
        <Dialog open onOpenChange={(open) => !open && onClose()}>
            <DialogContent showCloseButton={false} className={cn(DIALOG_SURFACE, "sm:max-w-lg")}>
                <DialogHead tone="neutral" icon={KeyRound}>
                    <DialogTitle className="truncate text-base">Public key of {profile.name}</DialogTitle>
                    <DialogDescription className={cn(dialogNoteClass("neutral"), "truncate")}>
                        {profile.fingerprint ? shortFingerprint(profile.fingerprint) : "The part of the key a server keeps"}
                    </DialogDescription>
                </DialogHead>
                <ScrollArea className={BODY_SCROLL}>
                    <div className="p-5">
                        {profile.publicKey && <SshPublicKeyPanel publicKey={profile.publicKey} fingerprint={profile.fingerprint} fileName={profile.name} />}
                    </div>
                </ScrollArea>
                <div className={cn(DIALOG_FOOTER, "flex justify-end")}>
                    <DialogClose asChild>
                        <Button variant="outline">Close</Button>
                    </DialogClose>
                </div>
            </DialogContent>
        </Dialog>
    );
}

interface CredentialDeleteDialogProps {
    profile: VaultCredential;
    onClose: () => void;
    onDeleted: (id: string) => void;
    /** After Undo brought it back, to load the list again. */
    onRestored: () => void | Promise<void>;
}

/**
 * Deletes one profile into Recently deleted, or at once with the tick. While connections log in
 * with it, it names them with a way to each and keeps Delete off, since the server refuses it anyway.
 */
export function CredentialDeleteDialog({ profile, onClose, onDeleted, onRestored }: CredentialDeleteDialogProps) {
    const [pending, setPending] = useState(false);
    const trash = useTrash("credential", onRestored);
    const used = profile.usedBy.length;

    const remove = async (permanently: boolean) => {
        setPending(true);
        try {
            const response = await fetch(`/api/credentials/${profile.id}${permanently ? "?permanently=true" : ""}`, { method: "DELETE" });
            const body = await response.json().catch(() => null);
            if (response.ok) {
                if (permanently) toast.success("Credential profile deleted");
                else toastMovedToTrash(`${profile.name} moved to Recently deleted`, trash.days, () => trash.undo([profile.id]));
                onDeleted(profile.id);
                return;
            }
            toast.error(body?.error || "The profile could not be deleted.");
        } catch (error) {
            log.error("Deleting a credential profile failed", { profileId: profile.id }, wrapError(error));
            toast.error("The profile could not be deleted.");
        } finally {
            setPending(false);
        }
        onClose();
    };

    if (used > 0) {
        return (
            <ConfirmDialog
                open
                onOpenChange={(open) => !open && onClose()}
                icon={Trash}
                destructive
                title={`Delete ${profile.name}?`}
                note={`${count(used, "connection")} still log${used === 1 ? "s" : ""} in with it`}
                description="Give them another login first, then it can go."
                confirmLabel="Delete profile"
                disabled
                onConfirm={() => undefined}
            >
                <ScrollArea className="rounded-lg border *:data-[slot=scroll-area-viewport]:max-h-60">
                    <ul className="divide-y">
                        {profile.usedBy.map((connection) => (
                            <li key={`${connection.id}-${connection.slot}`} className="flex min-w-0 items-center gap-2.5 px-3 py-2">
                                <span className="flex size-7 shrink-0 items-center justify-center rounded-lg border bg-muted/50" aria-hidden="true">
                                    <AdapterIcon adapterId={connection.adapterId} className="size-3.5" />
                                </span>
                                <div className="min-w-0 flex-1">
                                    <div className="truncate text-sm font-medium">{connection.name}</div>
                                    <div className="truncate text-xs text-muted-foreground">{connectionKind(connection)}</div>
                                </div>
                                <Link href={connectionHref(connection)} className="flex shrink-0 items-center gap-1 rounded-sm text-xs font-medium outline-none hover:underline hover:underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring/50">
                                    Open
                                    <ArrowUpRight className="size-3 text-muted-foreground" aria-hidden="true" />
                                </Link>
                            </li>
                        ))}
                    </ul>
                </ScrollArea>
            </ConfirmDialog>
        );
    }

    const Icon = CREDENTIAL_TYPE_INFO[profile.type].icon;
    return (
        <TrashConfirmDialog
            onOpenChange={(open) => !open && onClose()}
            icon={Trash}
            title="Delete profile?"
            confirmLabel="Delete profile"
            days={trash.days}
            canDeletePermanently={trash.canDeletePermanently}
            permanentLine="For a login that leaked. It skips Recently deleted with the secret it holds."
            permanentNotice={`${profile.name} is gone at once. DBackup keeps no copy of it anywhere.`}
            isPending={pending}
            onConfirm={(permanently) => void remove(permanently)}
        >
            <DialogItemList items={[{ name: profile.name, detail: CREDENTIAL_TYPE_INFO[profile.type].title, icon: Icon }]} />
        </TrashConfirmDialog>
    );
}
