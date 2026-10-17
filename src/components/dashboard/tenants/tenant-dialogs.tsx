"use client";

import { useId, useRef, useState } from "react";
import { Building2, Loader2, Pencil, Plus, Share2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { createTenant, deleteTenant, renameTenant, setTenantSharing } from "@/app/actions/tenant/tenant";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog, DIALOG_FOOTER, DIALOG_SURFACE, DialogHead, DialogItemList, dialogNoteClass } from "@/components/ui/confirm-dialog";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { cn } from "@/lib/utils";
import type { TenantRow } from "@/services/tenant/tenant-service";
import { deletionLoss, removalText } from "./tenant-words";

const log = logger.child({ component: "tenant-dialogs" });

/** The longest name a tenant may have, like the server checks it. */
const NAME_MAX = 60;

interface TenantNameDialogProps {
    /** The tenant to rename, none for New tenant. */
    tenant: TenantRow | null;
    onClose: () => void;
    /** After the save, with the tenant a new one became. */
    onSaved: (tenant: { id: string; name: string }) => void;
}

/**
 * New tenant and Rename in one dialog: blue while it adds, violet while it renames. A new tenant
 * starts with the built-in templates and without members.
 */
export function TenantNameDialog({ tenant, onClose, onSaved }: TenantNameDialogProps) {
    const tone = tenant ? "edit" : "create";
    const [name, setName] = useState(tenant?.name ?? "");
    const [error, setError] = useState<string | null>(null);
    const [pending, setPending] = useState(false);
    const [shares, setShares] = useState(false);
    const field = useRef<HTMLInputElement>(null);
    const nameId = useId();
    const sharesId = useId();
    const trimmed = name.trim();

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!trimmed || pending) return;
        if (tenant && trimmed === tenant.name) {
            onClose();
            return;
        }
        setPending(true);
        try {
            if (tenant) {
                const result = await renameTenant(tenant.id, trimmed);
                if (!result.success) {
                    setError(result.error);
                    return;
                }
                toast.success(`Renamed to ${trimmed}`);
                onSaved({ id: tenant.id, name: trimmed });
                return;
            }
            const result = await createTenant(trimmed, shares);
            if (!result.success) {
                setError(result.error);
                return;
            }
            toast.success(`${result.data.name} is created`);
            onSaved(result.data);
        } catch (failure: unknown) {
            // Without the platform admin role the actions throw instead of answering.
            log.warn("Saving a tenant failed", { tenantId: tenant?.id }, wrapError(failure));
            setError(tenant ? "The tenant could not be renamed." : "The tenant could not be created.");
        } finally {
            setPending(false);
        }
    };

    return (
        <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
            <DialogContent
                tone={tone}
                showCloseButton={false}
                className={cn(DIALOG_SURFACE, "sm:max-w-md")}
                onOpenAutoFocus={(event) => {
                    event.preventDefault();
                    field.current?.focus();
                    field.current?.select();
                }}
            >
                <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
                    <DialogHead tone={tone} icon={tenant ? Pencil : Building2}>
                        <DialogTitle className="truncate text-base">{tenant ? `Rename ${tenant.name}` : "New tenant"}</DialogTitle>
                        <DialogDescription className={dialogNoteClass(tone)}>
                            {tenant ? "Its people see the new name at once" : "A customer with its own connections, jobs and people"}
                        </DialogDescription>
                    </DialogHead>

                    <div className="space-y-4 p-5">
                        <div className="space-y-2">
                            <Label htmlFor={nameId}>Name</Label>
                            <Input
                                ref={field}
                                id={nameId}
                                value={name}
                                maxLength={NAME_MAX}
                                placeholder="Acme Corp"
                                onChange={(event) => {
                                    setName(event.target.value);
                                    setError(null);
                                }}
                                disabled={pending}
                                autoComplete="off"
                                aria-invalid={error ? true : undefined}
                                aria-describedby={`${nameId}-message`}
                            />
                            <p id={`${nameId}-message`} className={cn("text-xs", error ? "text-destructive" : "text-muted-foreground")}>
                                {error ?? (tenant ? "Every tenant has a name of its own." : "It starts with the built-in templates and without members. Add them under Members.")}
                            </p>
                        </div>
                        {!tenant && (
                            <div className="flex items-start gap-3 rounded-lg border p-3">
                                <Checkbox id={sharesId} checked={shares} onCheckedChange={(value) => setShares(value === true)} className="mt-0.5" disabled={pending} />
                                <div className="space-y-0.5">
                                    <Label htmlFor={sharesId} className="text-sm leading-snug font-medium">Shares with customers</Label>
                                    <p className="text-xs text-muted-foreground">A tenant of the MSP. It can give single databases, destinations and notification channels to other tenants.</p>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className={cn(DIALOG_FOOTER, "flex items-center justify-end gap-2")}>
                        <DialogClose asChild>
                            <Button type="button" variant="outline" disabled={pending}>Cancel</Button>
                        </DialogClose>
                        <Button type="submit" disabled={pending || !trimmed}>
                            {pending ? <Loader2 className="animate-spin" /> : tenant ? <Pencil /> : <Plus />}
                            {tenant ? "Rename" : "Create tenant"}
                        </Button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    );
}

interface TenantSharingDialogProps {
    tenant: TenantRow;
    onClose: () => void;
    onChanged: () => void;
}

/**
 * Switches whether a tenant shares with customers: gives single databases, destinations and
 * notification channels to other tenants. The server refuses to switch it off while the tenant
 * gives anything away, and says why.
 */
export function TenantSharingDialog({ tenant, onClose, onChanged }: TenantSharingDialogProps) {
    const [pending, setPending] = useState(false);
    const on = !tenant.sharesWithCustomers;

    const save = async () => {
        setPending(true);
        try {
            const result = await setTenantSharing(tenant.id, on);
            if (!result.success) {
                toast.error(result.error);
                return;
            }
            toast.success(on ? `${tenant.name} shares with customers now` : `${tenant.name} shares nothing with customers now`);
            onChanged();
        } catch (error: unknown) {
            log.warn("Switching the sharing of a tenant failed", { tenantId: tenant.id }, wrapError(error));
            toast.error("The tenant could not be changed.");
        } finally {
            setPending(false);
        }
    };

    return (
        <ConfirmDialog
            open
            onOpenChange={(open) => !open && onClose()}
            icon={Share2}
            tone="edit"
            title={on ? `Let ${tenant.name} share with customers?` : `Stop ${tenant.name} sharing with customers?`}
            note={on ? "A tenant of the MSP" : "Only once it gives nothing away"}
            description={on
                ? "It can give single databases, destinations and notification channels to other tenants, by whoever holds Share with customers."
                : "It gives no databases, destinations or notification channels to other tenants from then on. It has to take back what it gives first."}
            confirmLabel={on ? "Share with customers" : "Stop sharing with customers"}
            isPending={pending}
            onConfirm={() => void save()}
        />
    );
}

interface TenantDeleteDialogProps {
    tenant: TenantRow;
    onClose: () => void;
    onDeleted: () => void;
}

/**
 * Deletes a tenant with everything it holds. The backups stay at its own destinations, but its keys
 * go with it, so the dialog waits for a tick that says those backups need a recovery kit from now on.
 * Its backups on destinations other tenants share with it go with it.
 */
export function TenantDeleteDialog({ tenant, onClose, onDeleted }: TenantDeleteDialogProps) {
    const [understood, setUnderstood] = useState(false);
    const [pending, setPending] = useState(false);
    const tickId = useId();

    const remove = async () => {
        setPending(true);
        try {
            const result = await deleteTenant(tenant.id);
            if (!result.success) {
                toast.error(result.error);
                return;
            }
            toast.success(removalText(result.data));
            onDeleted();
        } catch (error: unknown) {
            log.warn("Deleting a tenant failed", { tenantId: tenant.id }, wrapError(error));
            toast.error("The tenant could not be deleted.");
        } finally {
            setPending(false);
        }
    };

    return (
        <ConfirmDialog
            open
            onOpenChange={(open) => !open && onClose()}
            icon={Trash2}
            destructive
            title={`Delete ${tenant.name}?`}
            note="Cannot be undone"
            description="It goes with everything it holds. Nothing of it waits in Recently deleted."
            confirmLabel="Delete tenant"
            isPending={pending}
            disabled={!understood}
            onConfirm={() => void remove()}
            className="sm:max-w-lg"
        >
            <DialogItemList items={deletionLoss(tenant)} />
            <ul className="grid gap-1.5 text-sm text-muted-foreground">
                <li>The backups stay at its own destinations, DBackup does not touch them.</li>
                {tenant.provided.destinations > 0 && (
                    <li>
                        Its backups on the {tenant.provided.destinations === 1 ? "destination" : `${tenant.provided.destinations} destinations`} other tenants share with it are deleted.
                    </li>
                )}
                <li>Its encryption keys are gone with it, so those backups only open with a recovery kit.</li>
                <li>The accounts stay. They only lose their place in {tenant.name}.</li>
            </ul>
            <div className={cn("flex items-start gap-3 rounded-lg border p-3 transition-colors", understood && "border-destructive/40 bg-destructive/5")}>
                <Checkbox id={tickId} checked={understood} onCheckedChange={(value) => setUnderstood(value === true)} className="mt-0.5" disabled={pending} />
                <Label htmlFor={tickId} className="text-sm leading-snug font-medium">
                    I have the recovery kits of its keys, or do not need its backups
                </Label>
            </div>
        </ConfirmDialog>
    );
}
