"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { removeAssignmentRule } from "@/app/actions/tenant/database-assignments";
import { ConfirmDialog, DialogItemList } from "@/components/ui/confirm-dialog";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import type { RuleRow, SourceAssignments } from "@/services/tenant/database-assignments";
import { ruleLosses } from "./assignment-model";

const log = logger.child({ component: "assignment-rule-remove" });

interface RuleRemoveDialogProps {
    serverId: string;
    rule: RuleRow;
    data: SourceAssignments;
    onClose: () => void;
    onRemoved: () => void;
}

/**
 * Asks before a rule ends. The tenant loses every database the rule gives now, and keeps the
 * backups of them made while the rule gave them, like after an assignment ended.
 */
export function RuleRemoveDialog({ serverId, rule, data, onClose, onRemoved }: RuleRemoveDialogProps) {
    const [pending, setPending] = useState(false);
    const losses = useMemo(() => ruleLosses(data, rule.id, new Date()), [data, rule.id]);

    const remove = async () => {
        setPending(true);
        try {
            const result = await removeAssignmentRule(serverId, rule.id);
            if (!result.success) {
                toast.error(result.error);
                return;
            }
            toast.success(`The rule ${rule.pattern} is removed`, { description: `${rule.tenantName} keeps the backups of its time and gets no new ones.` });
            onRemoved();
        } catch (error: unknown) {
            log.warn("Removing a rule failed", { ruleId: rule.id }, wrapError(error));
            toast.error("The rule could not be removed.");
        } finally {
            setPending(false);
        }
    };

    return (
        <ConfirmDialog
            open
            onOpenChange={(open) => !open && onClose()}
            destructive
            title={`Remove the rule ${rule.pattern}?`}
            note="Cannot be undone"
            description={`${rule.tenantName} loses the databases this rule gives it from now on and keeps the backups made while the rule gave them. A database assigned by name stays where it is.`}
            confirmLabel="Remove rule"
            isPending={pending}
            onConfirm={() => void remove()}
        >
            {losses.length > 0 ? (
                <DialogItemList
                    size="small"
                    items={losses.map((loss) => ({
                        name: loss.name,
                        detail: loss.next ? `goes to ${loss.next.tenantName}, rule ${loss.next.pattern}` : "goes to nobody else",
                    }))}
                />
            ) : (
                <p className="text-sm text-muted-foreground">It gives no database of the server now. Backups it gave before stay with {rule.tenantName}.</p>
            )}
        </ConfirmDialog>
    );
}
