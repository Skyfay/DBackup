"use client";

import { useState } from "react";
import { Info, Loader2, Zap } from "lucide-react";
import { toast } from "sonner";
import { setDatabaseOnDemand, setRuleOnDemand } from "@/app/actions/tenant/database-assignments";
import { SwitchList, SwitchRow } from "@/components/adapter/setting-switches";
import { Button } from "@/components/ui/button";
import { DIALOG_FOOTER, DIALOG_SURFACE, DialogHead, dialogNoteClass } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { NumberStepper } from "@/components/ui/number-stepper";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { ON_DEMAND_DEFAULT, ON_DEMAND_MAX, ON_DEMAND_MIN } from "@/lib/tenant/sharing";
import { cn } from "@/lib/utils";

const log = logger.child({ component: "assignment-on-demand-dialog" });

/** What backups on demand are switched for: one database given by name, or every database of a rule. */
export type OnDemandTarget =
    | { kind: "database"; name: string; tenantName: string; perDay: number | null }
    | { kind: "rule"; ruleId: string; pattern: string; tenantName: string; perDay: number | null };

interface OnDemandDialogProps {
    serverId: string;
    serverName: string;
    target: OnDemandTarget;
    onClose: () => void;
    onSaved: () => void;
}

/**
 * Backups on demand of a database given to a tenant, or of every database a rule gives, in the
 * violet of an edit: a switch and how many a day. The tenant then starts a backup of its database
 * itself, which runs the job of this server for that database alone, in this tenant's queue.
 */
export function OnDemandDialog({ serverId, serverName, target, onClose, onSaved }: OnDemandDialogProps) {
    const [on, setOn] = useState(target.perDay !== null);
    const [perDay, setPerDay] = useState(target.perDay ?? ON_DEMAND_DEFAULT);
    const [pending, setPending] = useState(false);
    const what = target.kind === "database" ? target.name : `the databases of the rule ${target.pattern}`;
    const value = on ? perDay : null;
    const changed = value !== target.perDay;

    const save = async () => {
        setPending(true);
        try {
            const result = target.kind === "database"
                ? await setDatabaseOnDemand(serverId, target.name, value)
                : await setRuleOnDemand(serverId, target.ruleId, value);
            if (!result.success) {
                toast.error(result.error);
                return;
            }
            toast.success(value === null ? `Backups on demand are off for ${what}` : `${target.tenantName} may start ${value} ${value === 1 ? "backup" : "backups"} a day of ${what}`);
            onSaved();
        } catch (error: unknown) {
            log.warn("Changing backups on demand failed", { serverId }, wrapError(error));
            toast.error("Backups on demand could not be changed.");
        } finally {
            setPending(false);
        }
    };

    return (
        <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
            <DialogContent tone="edit" showCloseButton={false} className={cn(DIALOG_SURFACE, "sm:max-w-lg")}>
                <DialogHead tone="edit" icon={Zap}>
                    <DialogTitle className="text-base">Backups on demand</DialogTitle>
                    <DialogDescription className={dialogNoteClass("edit")}>
                        {target.kind === "database" ? target.name : <span className="font-mono">{target.pattern}</span>} · {target.tenantName} on {serverName}
                    </DialogDescription>
                </DialogHead>

                <div className="space-y-4 p-5">
                    <SwitchList>
                        <SwitchRow
                            title={`${target.tenantName} backs up ${target.kind === "database" ? target.name : "each of them"} itself`}
                            description="With Back up now on its Backups page."
                            checked={on}
                            onCheckedChange={setOn}
                            disabled={pending}
                            aside={on ? (
                                <span className="flex items-center gap-2 text-sm text-muted-foreground">
                                    <NumberStepper
                                        aria-label="Backups a day"
                                        value={perDay}
                                        onValueChange={setPerDay}
                                        min={ON_DEMAND_MIN}
                                        max={ON_DEMAND_MAX}
                                        decrementLabel="Fewer a day"
                                        incrementLabel="More a day"
                                        disabled={pending}
                                        className="w-28"
                                    />
                                    a day
                                </span>
                            ) : undefined}
                        />
                    </SwitchList>
                    <p className="flex gap-2.5 rounded-lg border bg-muted/30 px-3 py-2.5 text-sm text-muted-foreground">
                        <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                        <span>
                            Each one runs the job of {serverName} for that database alone, in your queue and your History, and never while the job runs.
                            {target.kind === "rule" ? " The number counts for each database of the rule on its own." : ""} A day ends at midnight in the time zone of the instance.
                        </span>
                    </p>
                </div>

                <div className={cn(DIALOG_FOOTER, "flex justify-end gap-2")}>
                    <Button variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
                    <Button onClick={() => void save()} disabled={!changed || pending}>
                        {pending ? <Loader2 className="animate-spin" /> : <Zap />}
                        Save
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
