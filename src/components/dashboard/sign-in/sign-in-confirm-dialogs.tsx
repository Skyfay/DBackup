"use client";

import { useState } from "react";
import { Power, PowerOff, Trash } from "lucide-react";
import { toast } from "sonner";
import { deleteSsoProvider, toggleSsoProvider } from "@/app/actions/auth/oidc";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, DialogItemList, type DialogListItem } from "@/components/ui/confirm-dialog";
import { listWords } from "@/lib/auth/access-summary";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import type { SsoPerson, SsoProviderRow } from "@/services/sso/sso-providers-types";
import { onlyWayIn } from "./sign-in-cells";

const log = logger.child({ component: "sign-in-confirm-dialogs" });

const people = (count: number) => (count === 1 ? "1 person is" : `${count} people are`);

/** A linked person with what they keep, or amber when this provider is their only way in. */
const itemOf = (person: SsoPerson): DialogListItem =>
    person.otherWays.length === 0
        ? { name: person.name, detail: "no other way in", detailTone: "warning" }
        : { name: person.name, detail: `keeps ${listWords(person.otherWays)}` };

/** "Tom Weber and Sara Nguyen sign in only through it", or "Tom Weber signs". */
const onlyThrough = (locked: SsoPerson[]) => `${listWords(locked.map((person) => person.name))} ${locked.length === 1 ? "signs" : "sign"} in only through it`;

interface ToggleProps {
    provider: SsoProviderRow;
    onClose: () => void;
    onDone: () => void;
}

/** Switches a provider on or off right away, for the menus and for Disable instead. */
export async function toggleProvider(provider: SsoProviderRow): Promise<boolean> {
    const enabled = !provider.enabled;
    try {
        const result = await toggleSsoProvider(provider.id, enabled);
        if (!result.success) {
            toast.error(result.error || "The provider could not be changed.");
            return false;
        }
        toast.success(`${provider.name} ${enabled ? "enabled" : "disabled"}`);
        return true;
    } catch (error) {
        // Without the right to change the settings the actions throw instead of answering.
        log.warn("Switching a sign-in provider failed", { providerId: provider.providerId }, wrapError(error));
        toast.error("The provider could not be changed.");
        return false;
    }
}

/** Asks before a provider is switched off while someone has no other way in, amber since it can be switched on again. */
export function SignInDisableDialog({ provider, onClose, onDone }: ToggleProps) {
    const [pending, setPending] = useState(false);
    const locked = onlyWayIn(provider);

    const confirm = async () => {
        setPending(true);
        if (await toggleProvider(provider)) return onDone();
        setPending(false);
    };

    return (
        <ConfirmDialog
            open
            onOpenChange={(open) => !open && onClose()}
            title={`Disable ${provider.name}?`}
            note="Can be switched on again"
            description={`${onlyThrough(locked)} and cannot sign in while it is off. The links stay, so switching it on again lets them back in.`}
            icon={PowerOff}
            tone="warning"
            confirmLabel="Disable provider"
            isPending={pending}
            onConfirm={confirm}
            className="sm:max-w-xl"
        >
            <DialogItemList items={locked.map(itemOf)} size="small" />
        </ConfirmDialog>
    );
}

interface DeleteProps {
    provider: SsoProviderRow;
    onClose: () => void;
    onDeleted: () => void;
    /** Switches it off instead, offered while it is on. */
    onDisabled?: () => void;
}

/** Asks before a provider is deleted, with everyone linked through it and who cannot sign in afterwards. */
export function SignInDeleteDialog({ provider, onClose, onDeleted, onDisabled }: DeleteProps) {
    const [pending, setPending] = useState(false);
    const locked = onlyWayIn(provider);
    const linked = provider.linked.length;

    const confirm = async () => {
        setPending(true);
        try {
            const result = await deleteSsoProvider(provider.id);
            if (result.success) {
                toast.success(`${provider.name} deleted`);
                return onDeleted();
            }
            toast.error(result.error || "The provider could not be deleted.");
        } catch (error) {
            log.warn("Deleting a sign-in provider failed", { providerId: provider.providerId }, wrapError(error));
            toast.error("The provider could not be deleted.");
        }
        setPending(false);
    };

    const disableInstead = async () => {
        setPending(true);
        if (await toggleProvider(provider)) return onDisabled?.();
        setPending(false);
    };

    const description = linked === 0
        ? "Nobody is linked to it, so nobody loses a way in."
        : `${people(linked)} linked to it and lose the link. ${locked.length > 0 ? `${onlyThrough(locked)} and cannot sign in afterwards, until someone sets a password for them.` : "Each of them keeps another way in."}`;

    return (
        <ConfirmDialog
            open
            onOpenChange={(open) => !open && onClose()}
            title={`Delete ${provider.name}?`}
            note="Cannot be undone"
            description={description}
            icon={Trash}
            destructive
            confirmLabel="Delete provider"
            isPending={pending}
            onConfirm={confirm}
            className="sm:max-w-xl"
        >
            {linked > 0 && <DialogItemList items={provider.linked.map(itemOf)} size="small" />}
            {provider.enabled && onDisabled && linked > 0 && (
                <div className="flex min-w-0 items-center gap-2.5 rounded-lg border bg-muted/30 p-3 text-xs">
                    <Power className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="min-w-0 flex-1">Disable it instead to keep the links and switch it on again later.</span>
                    <Button type="button" variant="outline" size="sm" className="h-7" onClick={() => void disableInstead()} disabled={pending}>
                        Disable instead
                    </Button>
                </div>
            )}
        </ConfirmDialog>
    );
}
