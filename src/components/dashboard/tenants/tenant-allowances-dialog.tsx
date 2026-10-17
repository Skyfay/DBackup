"use client";

import { useState } from "react";
import { Info, Loader2, Lock } from "lucide-react";
import { toast } from "sonner";
import { setTenantAllowances } from "@/app/actions/tenant/tenant";
import { SwitchList, SwitchRow } from "@/components/adapter/setting-switches";
import { Button } from "@/components/ui/button";
import { DIALOG_FOOTER, DIALOG_SURFACE, DialogHead, dialogNoteClass } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { ALLOWANCE_KINDS, ALLOWANCE_LABELS, type AllowanceKind, type TenantAllowances } from "@/lib/tenant/allowances";
import { cn } from "@/lib/utils";
import type { TenantRow } from "@/services/tenant/tenant-service";
import { allowancesPatch, providedSentence, sharedParts } from "./tenant-words";

const log = logger.child({ component: "tenant-allowances-dialog" });

/** What each switch lets the tenant do, under its label. */
const DESCRIPTIONS: Record<AllowanceKind, string> = {
    databases: "Its own servers, backed up by its own jobs.",
    directorySources: "Folders of its own servers to back up.",
    destinations: "Off: its jobs write only to the destinations other tenants share with it.",
    channels: "Off: it tells only through the channels other tenants share with it.",
    apiKeys: "Off: no key of it works any more, and nobody makes a new one.",
};

interface TenantAllowancesDialogProps {
    tenant: TenantRow;
    onClose: () => void;
    onSaved: () => void;
}

/**
 * What a tenant may add itself, which the platform decides, in the violet of an edit: a switch per
 * kind of connection, and below them what other tenants share with it. Off only stops new ones.
 */
export function TenantAllowancesDialog({ tenant, onClose, onSaved }: TenantAllowancesDialogProps) {
    const [allowances, setAllowances] = useState<TenantAllowances>(tenant.allowances);
    const [pending, setPending] = useState(false);
    const patch = allowancesPatch(tenant.allowances, allowances);
    const changed = Object.keys(patch).length > 0;
    const provided = sharedParts(tenant.provided).length > 0;

    const save = async () => {
        setPending(true);
        try {
            const result = await setTenantAllowances(tenant.id, patch);
            if (!result.success) {
                toast.error(result.error);
                return;
            }
            toast.success(`Saved what ${tenant.name} may add`);
            onSaved();
        } catch (error: unknown) {
            log.warn("Changing what a tenant may add failed", { tenantId: tenant.id }, wrapError(error));
            toast.error("The tenant could not be changed.");
        } finally {
            setPending(false);
        }
    };

    return (
        <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
            <DialogContent tone="edit" showCloseButton={false} className={cn(DIALOG_SURFACE, "sm:max-w-lg")}>
                <DialogHead tone="edit" icon={Lock}>
                    <DialogTitle className="truncate text-base">What {tenant.name} may add</DialogTitle>
                    <DialogDescription className={dialogNoteClass("edit")}>Platform · decides what the tenant adds itself</DialogDescription>
                </DialogHead>

                <ScrollArea className="min-h-0 flex-1 *:data-[slot=scroll-area-viewport]:max-h-[calc(95dvh-9.5rem)]">
                    <div className="space-y-4 p-5">
                        <SwitchList>
                            {ALLOWANCE_KINDS.map((kind) => (
                                <SwitchRow
                                    key={kind}
                                    title={ALLOWANCE_LABELS[kind]}
                                    description={DESCRIPTIONS[kind]}
                                    checked={allowances[kind]}
                                    onCheckedChange={(on) => setAllowances((current) => ({ ...current, [kind]: on }))}
                                    disabled={pending}
                                />
                            ))}
                        </SwitchList>
                        <p className="flex gap-2.5 rounded-lg border bg-muted/30 px-3 py-2.5 text-sm text-muted-foreground">
                            <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                            <span>Off stops new ones, what it has keeps working and stays its own. API keys are the exception, off stops the keys it has too.</span>
                        </p>
                        <section className="space-y-1 border-t pt-4">
                            <h3 className="text-sm font-medium">Provided to it</h3>
                            <p className={cn("text-sm tabular-nums", !provided && "text-muted-foreground")}>{providedSentence(tenant.provided)}</p>
                            <p className="text-xs text-muted-foreground">Set on each destination or channel of the tenant that shares it.</p>
                        </section>
                    </div>
                </ScrollArea>

                <div className={cn(DIALOG_FOOTER, "flex justify-end gap-2")}>
                    <Button variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
                    <Button onClick={() => void save()} disabled={!changed || pending}>
                        {pending && <Loader2 className="animate-spin" />}
                        Save
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
