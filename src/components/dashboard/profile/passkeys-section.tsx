"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { Fingerprint, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { togglePasskeyTwoFactor } from "@/app/actions/auth/user";
import { BackupRowMenu } from "@/components/dashboard/storage/explorer/backup-menus";
import { DateDisplay } from "@/components/utils/date-display";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, DialogItemList } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { authClient } from "@/lib/auth/client";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { StepDialog } from "./security-dialogs";

const log = logger.child({ component: "passkeys-section" });

export interface PasskeyRow {
    id: string;
    name: string | null;
    createdAt: Date | string | null;
    /** Synced between the devices of a password manager, like iCloud Keychain. */
    backedUp: boolean;
}

/** The passkeys of the viewer, loaded from better-auth, and a way to load them again. */
export function usePasskeys() {
    const [passkeys, setPasskeys] = useState<PasskeyRow[] | null>(null);
    const load = useCallback(async () => {
        try {
            const result = await authClient.passkey.listUserPasskeys();
            const rows = (result.data ?? []).map((passkey) => ({ id: passkey.id, name: passkey.name ?? null, createdAt: passkey.createdAt ?? null, backedUp: !!passkey.backedUp }));
            setPasskeys(rows);
            return rows;
        } catch (error) {
            log.warn("Loading the passkeys failed", {}, wrapError(error));
            setPasskeys([]);
            return [];
        }
    }, []);
    useEffect(() => {
        void load();
    }, [load]);
    return { passkeys, load };
}

function NameDialog({ open, onOpenChange, title, note, tone, confirm, initial, onSave }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    note: string;
    tone: "create" | "edit";
    confirm: string;
    initial: string;
    onSave: (name: string) => Promise<boolean>;
}) {
    const [name, setName] = useState(initial);
    const [busy, setBusy] = useState(false);
    const id = useId();

    useEffect(() => {
        if (open) setName(initial);
    }, [open, initial]);

    const submit = async () => {
        if (!name.trim()) return;
        setBusy(true);
        const done = await onSave(name.trim());
        setBusy(false);
        if (done) onOpenChange(false);
    };

    return (
        <StepDialog
            open={open}
            onOpenChange={onOpenChange}
            tone={tone}
            icon={tone === "create" ? Plus : Pencil}
            title={title}
            note={note}
            busy={busy}
            onSubmit={() => void submit()}
            footer={
                <>
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
                    <Button type="submit" disabled={busy || !name.trim()}>
                        {busy && <Loader2 className="animate-spin" />}
                        {confirm}
                    </Button>
                </>
            }
        >
            <div className="grid gap-2">
                <Label htmlFor={id}>Name</Label>
                <Input id={id} value={name} maxLength={60} placeholder="Like MacBook Pro or YubiKey" autoFocus onChange={(event) => setName(event.target.value)} />
                <p className="text-xs text-muted-foreground">Where it lives, so you tell your passkeys apart.</p>
            </div>
        </StepDialog>
    );
}

interface PasskeysSectionProps {
    userId: string;
    canManage: boolean;
    /** A passkey counts as the second factor, which ends with the last passkey. */
    passkeyFactor: boolean;
    passkeys: PasskeyRow[] | null;
    reload: () => Promise<PasskeyRow[]>;
    onFactorChanged: () => void;
}

/** The passkeys of the viewer with Add a passkey, and Rename and Delete on each. */
export function PasskeysSection({ userId, canManage, passkeyFactor, passkeys, reload, onFactorChanged }: PasskeysSectionProps) {
    const [adding, setAdding] = useState(false);
    const [renaming, setRenaming] = useState<PasskeyRow | null>(null);
    const [removing, setRemoving] = useState<PasskeyRow | null>(null);
    const [busy, setBusy] = useState(false);

    const add = async (name: string) => {
        try {
            const result = await authClient.passkey.addPasskey({ name });
            if (result?.error) {
                toast.error(String(result.error.message || "") || "The passkey could not be added.");
                return false;
            }
            toast.success("Passkey added");
            await reload();
            return true;
        } catch (error) {
            log.warn("Adding a passkey failed", {}, wrapError(error));
            toast.error("The passkey could not be added.");
            return false;
        }
    };

    const rename = async (name: string) => {
        if (!renaming) return false;
        try {
            const result = await authClient.passkey.updatePasskey({ id: renaming.id, name });
            if (result?.error) {
                toast.error(result.error.message || "The passkey could not be renamed.");
                return false;
            }
            await reload();
            return true;
        } catch (error) {
            log.warn("Renaming a passkey failed", {}, wrapError(error));
            toast.error("The passkey could not be renamed.");
            return false;
        }
    };

    const remove = async () => {
        if (!removing) return;
        setBusy(true);
        try {
            const result = await authClient.passkey.deletePasskey({ id: removing.id });
            if (result?.error) {
                toast.error(result.error.message || "The passkey could not be deleted.");
                return;
            }
            toast.success("Passkey deleted");
            const rest = await reload();
            // Without a passkey none can count as the second factor any more.
            if (rest.length === 0 && passkeyFactor) {
                const toggled = await togglePasskeyTwoFactor(userId, false);
                if (toggled.success) {
                    toast.info("A passkey no longer counts as the second factor, the last one is gone.");
                    onFactorChanged();
                }
            }
        } catch (error) {
            log.warn("Deleting a passkey failed", {}, wrapError(error));
            toast.error("The passkey could not be deleted.");
        } finally {
            setBusy(false);
            setRemoving(null);
        }
    };

    return (
        <div data-setting="profile.passkeys" className="overflow-hidden rounded-lg border">
            <div className="flex items-center gap-2 px-4 py-3">
                <span className="text-sm font-semibold">Passkeys</span>
                {passkeys && <span className="text-xs text-muted-foreground tabular-nums">{passkeys.length}</span>}
                {canManage && (
                    <Button type="button" tone="create" size="sm" className="ml-auto" onClick={() => setAdding(true)}>
                        <Plus />
                        Add a passkey
                    </Button>
                )}
            </div>
            {passkeys === null ? (
                <div className="border-t px-4 py-3">
                    <Skeleton className="h-9 w-full" />
                </div>
            ) : passkeys.length === 0 ? (
                <p className="border-t px-4 py-3 text-sm text-muted-foreground">No passkey yet. One signs you in with a fingerprint, a face or a security key.</p>
            ) : (
                <ul className="divide-y border-t">
                    {passkeys.map((passkey) => (
                        <li key={passkey.id} className="flex min-w-0 items-center gap-3 px-4 py-2.5">
                            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted/50" aria-hidden="true">
                                <Fingerprint className="size-4 text-muted-foreground" />
                            </span>
                            <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium">{passkey.name || "Unnamed passkey"}</p>
                                <p className="truncate text-xs text-muted-foreground">
                                    {passkey.backedUp ? "Synced between your devices" : "On one device"}
                                    {passkey.createdAt && <> · added <DateDisplay date={passkey.createdAt} format="P" /></>}
                                </p>
                            </div>
                            {canManage && (
                                <BackupRowMenu
                                    name={passkey.name || "Unnamed passkey"}
                                    groups={[
                                        { actions: [{ id: "rename", label: "Rename", icon: Pencil, onSelect: () => setRenaming(passkey), tone: "edit" }] },
                                        { actions: [{ id: "delete", label: "Delete", icon: Trash2, onSelect: () => setRemoving(passkey), tone: "destructive" }] },
                                    ]}
                                />
                            )}
                        </li>
                    ))}
                </ul>
            )}

            <NameDialog open={adding} onOpenChange={setAdding} title="Add a passkey" note="Your browser asks for it next" tone="create" confirm="Add a passkey" initial="" onSave={add} />
            <NameDialog open={renaming !== null} onOpenChange={(open) => !open && setRenaming(null)} title="Rename the passkey" note={renaming?.name || "Unnamed passkey"} tone="edit" confirm="Save" initial={renaming?.name ?? ""} onSave={rename} />
            <ConfirmDialog
                open={removing !== null}
                onOpenChange={(open) => !open && setRemoving(null)}
                icon={Trash2}
                destructive
                title="Delete the passkey?"
                note="It no longer signs you in"
                description={passkeyFactor && passkeys?.length === 1 ? "It is your last one, so a passkey no longer counts as the second factor." : undefined}
                confirmLabel="Delete passkey"
                isPending={busy}
                onConfirm={() => void remove()}
            >
                {removing && <DialogItemList items={[{ name: removing.name || "Unnamed passkey", icon: Fingerprint }]} />}
            </ConfirmDialog>
        </div>
    );
}
