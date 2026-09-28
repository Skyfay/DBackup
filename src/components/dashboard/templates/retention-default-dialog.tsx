"use client";

import { useMemo, useState } from "react";
import { Star } from "lucide-react";
import { toast } from "sonner";
import { setDefaultRetentionPolicy } from "@/app/actions/templates";
import { consequencesOf, RetentionConsequences, totalRemoved } from "@/components/templates/retention-consequences";
import { keepsPhrase } from "@/components/templates/retention-words";
import { useRetentionTargets } from "@/components/templates/use-retention-targets";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import type { RetentionRow } from "@/services/templates/templates-types";
import { count } from "./template-format";

const log = logger.child({ component: "RetentionDefaultDialog" });

interface RetentionDefaultDialogProps {
    policy: RetentionRow;
    /** The policy that is the default now, if there is one. */
    current: RetentionRow | null;
    onClose: () => void;
    onDone: () => void;
}

/**
 * Asks before a policy becomes the default. Every destination without a policy of its own follows
 * the default, so it names them with what their next run removes, in amber, since a new default
 * can remove backups elsewhere.
 */
export function RetentionDefaultDialog({ policy, current, onClose, onDone }: RetentionDefaultDialogProps) {
    const [pending, setPending] = useState(false);
    const { targets, loading } = useRetentionTargets({ followers: true });
    const rows = useMemo(() => (targets ? consequencesOf(targets, policy.config) : []), [targets, policy.config]);
    const total = totalRemoved(rows);
    const followers = rows.length;

    const confirm = async () => {
        setPending(true);
        try {
            const result = await setDefaultRetentionPolicy(policy.id);
            if (result.success) {
                toast.success(`${policy.name} is the default policy now`);
                onDone();
                return;
            }
            toast.error(result.error || "The default could not be changed.");
        } catch (error: unknown) {
            // Without the right to write templates the action throws instead of answering.
            log.warn("The default retention policy could not be changed", { policyId: policy.id }, wrapError(error));
            toast.error("The default could not be changed.");
        } finally {
            setPending(false);
        }
    };

    const note = loading
        ? "Working out what it removes"
        : total.backups > 0
          ? `Removes ${count(total.backups, "backup")} at ${count(total.destinations, "destination")}`
          : "Removes no backup";
    const description = loading || !targets
        ? "Every destination without a policy of its own follows the default."
        : followers === 0
          ? "No destination follows the default yet. From now on a destination without a policy of its own keeps its backups by it."
          : `${count(followers, "destination")} ${followers === 1 ? "has" : "have"} no policy of ${followers === 1 ? "its" : "their"} own and ${followers === 1 ? "follows" : "follow"} the default. From their next run they keep ${keepsPhrase(policy.config)} instead of ${current ? current.name : "every backup"}.`;

    return (
        <ConfirmDialog
            open
            onOpenChange={(open) => !open && onClose()}
            tone="warning"
            icon={Star}
            title={`Make ${policy.name} the default?`}
            note={note}
            description={description}
            confirmLabel="Make default"
            isPending={pending}
            disabled={loading}
            onConfirm={confirm}
        >
            {(loading || followers > 0) && <RetentionConsequences targets={targets} loading={loading} config={policy.config} summary={false} shown={4} />}
            <p className="text-xs text-muted-foreground">Destinations that picked a policy keep theirs.</p>
        </ConfirmDialog>
    );
}
