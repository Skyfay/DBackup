"use client";

import { useState } from "react";
import { Info, Loader2, Zap } from "lucide-react";
import { toast } from "sonner";
import { setDatabaseOnDemand, setRuleOnDemand } from "@/app/actions/tenant/database-assignments";
import { ChoiceCards, type ModeOption } from "@/components/adapter/connection-mode-choice";
import { Button } from "@/components/ui/button";
import { DIALOG_FOOTER, DIALOG_SURFACE, DialogHead, dialogNoteClass } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { NumberStepper } from "@/components/ui/number-stepper";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { ON_DEMAND_DEFAULT, ON_DEMAND_MAX, ON_DEMAND_MIN, ON_DEMAND_OFF, onDemandSource, type OnDemandSource } from "@/lib/tenant/sharing";
import { cn } from "@/lib/utils";

const log = logger.child({ component: "assignment-on-demand-dialog" });

/** What backups on demand are set for: one database given by name, or every database of a rule. */
export type OnDemandTarget = (
    | { kind: "database"; name: string }
    | { kind: "rule"; ruleId: string; pattern: string }
) & {
    tenantName: string;
    /** What it stores: null as the tenant, 0 off, else its own number a day. */
    perDay: number | null;
    /** What the platform lets the tenant start of every database, null for none. */
    tenantPerDay: number | null;
};

interface OnDemandDialogProps {
    serverId: string;
    serverName: string;
    target: OnDemandTarget;
    onClose: () => void;
    onSaved: () => void;
}

/** "3 a day", "none" or "off here", what a stored number allows. */
const words = (perDay: number | null, tenantName: string) =>
    perDay === null ? `as ${tenantName}` : perDay === ON_DEMAND_OFF ? "off here" : `${perDay} a day`;

/**
 * Backups on demand of a database given to a tenant, or of every database a rule gives, in the
 * violet of an edit: as the tenant, which follows the number the platform sets for it, a number of
 * its own, or off. The tenant then starts a backup of its database itself, which runs the job of
 * this server for that database alone, in this tenant's queue.
 */
export function OnDemandDialog({ serverId, serverName, target, onClose, onSaved }: OnDemandDialogProps) {
    const [choice, setChoice] = useState<OnDemandSource>(onDemandSource(target.perDay));
    const [perDay, setPerDay] = useState(target.perDay !== null && target.perDay !== ON_DEMAND_OFF ? target.perDay : target.tenantPerDay ?? ON_DEMAND_DEFAULT);
    const [pending, setPending] = useState(false);
    const database = target.kind === "database";
    const what = database ? target.name : `the databases of the rule ${target.pattern}`;
    const value = choice === "tenant" ? null : choice === "off" ? ON_DEMAND_OFF : perDay;
    const changed = value !== target.perDay;
    const tenantWords = target.tenantPerDay === null ? "none" : `${target.tenantPerDay} a day`;

    const options: ModeOption[] = [
        {
            value: "tenant",
            title: `As ${target.tenantName}, ${tenantWords}`,
            description: `Follows the number the platform sets for ${target.tenantName}, also when it changes.`,
        },
        {
            value: "own",
            title: "A number of its own",
            description: database ? `Only for ${target.name}, the other databases of ${target.tenantName} keep theirs.` : `For each database of the rule, the other databases of ${target.tenantName} keep theirs.`,
            content: (
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
                    a day, whatever {target.tenantName} has
                </span>
            ),
        },
        {
            value: "off",
            title: database ? `Off for ${target.name}` : "Off for the databases of the rule",
            description: `${target.tenantName} cannot start a backup of ${database ? target.name : "them"}, whatever it may for its other databases.`,
        },
    ];

    const save = async () => {
        setPending(true);
        try {
            const result = database
                ? await setDatabaseOnDemand(serverId, target.name, value)
                : await setRuleOnDemand(serverId, target.ruleId, value);
            if (!result.success) {
                toast.error(result.error);
                return;
            }
            toast.success(value === null
                ? `${database ? target.name : "The rule"} follows ${target.tenantName} again`
                : value === ON_DEMAND_OFF ? `Backups on demand are off for ${what}` : `${target.tenantName} may start ${value} ${value === 1 ? "backup" : "backups"} a day of ${what}`);
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
            <DialogContent tone="edit" showCloseButton={false} className={cn(DIALOG_SURFACE, "sm:max-w-xl")}>
                <DialogHead tone="edit" icon={Zap}>
                    <DialogTitle className="text-base">Backups on demand</DialogTitle>
                    <DialogDescription className={dialogNoteClass("edit")}>
                        {database ? target.name : <span className="font-mono">{target.pattern}</span>} · {target.tenantName} on {serverName}
                    </DialogDescription>
                </DialogHead>

                <div className="space-y-4 p-5">
                    <ChoiceCards value={choice} onValueChange={(next) => setChoice(next as OnDemandSource)} options={options} className="sm:grid-cols-1" disabled={pending} aria-label="Backups on demand" />
                    <p className="flex gap-2.5 rounded-lg border bg-muted/30 px-3 py-2.5 text-sm text-muted-foreground">
                        <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                        <span>
                            Each one runs the job of {serverName} for that database alone, in your queue and your History, and never while the job runs.
                            {database ? "" : " The number counts for each database of the rule on its own."} A day ends at midnight in the time zone of the instance.
                        </span>
                    </p>
                </div>

                <div className={cn(DIALOG_FOOTER, "flex items-center justify-end gap-2")}>
                    {changed && (
                        <span className="mr-auto min-w-0 truncate text-xs text-muted-foreground">
                            Changed: from {words(target.perDay, target.tenantName)} to {words(value, target.tenantName)}
                        </span>
                    )}
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
