"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { ChevronDown, Link2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { listInvitations, revokeInvitation } from "@/app/actions/tenant/invitation";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { cn } from "@/lib/utils";
import type { InvitationRow } from "@/services/tenant/invitation-service";
import { nextToExpire, openInvitationsLabel } from "./invitation-model";
import { GroupTag } from "./user-cells";

const log = logger.child({ component: "invitations-banner" });

/** The open links, or null when they cannot be read. Nothing to show is the answer for a viewer who may not see them. */
async function loadInvitations(): Promise<InvitationRow[] | null> {
    try {
        const result = await listInvitations();
        return result.success ? result.data : null;
    } catch (error) {
        log.warn("Loading the open invitations failed", {}, wrapError(error));
        return null;
    }
}

/**
 * The open invitations of the list, loaded once and again after a change. Empty while they load
 * or when they cannot, and never asked for while `enabled` is false, like on the list of every account.
 */
export function useOpenInvitations(enabled = true) {
    const [invitations, setInvitations] = useState<InvitationRow[]>([]);

    useEffect(() => {
        if (!enabled) return;
        let ignore = false;
        void loadInvitations().then((rows) => {
            if (!ignore && rows) setInvitations(rows);
        });
        return () => {
            ignore = true;
        };
    }, [enabled]);

    const reload = useCallback(async () => {
        if (!enabled) return;
        const rows = await loadInvitations();
        if (rows) setInvitations(rows);
    }, [enabled]);

    return { invitations, reload };
}

interface InvitationsBannerProps {
    invitations: InvitationRow[];
    /** May take a link back, which changes the users. */
    canManage: boolean;
    onRevoked: () => void;
    className?: string;
}

/**
 * The links nobody used yet, as a quiet banner with their count that opens to the list: the group
 * each adds someone to, its note, who made it and when it runs out, with Revoke. Nothing shows
 * while every link is used or gone.
 */
export function InvitationsBanner({ invitations, canManage, onRevoked, className }: InvitationsBannerProps) {
    const [expanded, setExpanded] = useState(false);
    const [revoking, setRevoking] = useState<InvitationRow | null>(null);
    const detailsId = useId();
    const next = nextToExpire(invitations);
    if (!next) return null;

    return (
        <div className={cn("relative overflow-hidden rounded-xl border bg-card p-4 pl-5 shadow-sm md:pl-6", className)}>
            <span className="absolute inset-y-0 left-0 w-1 bg-muted-foreground/40" aria-hidden="true" />
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground" aria-hidden="true">
                        <Link2 className="size-5" />
                    </span>
                    <div className="min-w-0 flex-1 space-y-0.5">
                        <p className="font-semibold leading-snug">{openInvitationsLabel(invitations.length)}</p>
                        <p className="text-sm text-muted-foreground">
                            {invitations.length === 1 ? "A link nobody used yet, it runs out " : "Links nobody used yet, the next one runs out "}
                            <RelativeTime date={next.expiresAt} />.
                        </p>
                    </div>
                </div>
                <Button
                    variant="outline"
                    size="sm"
                    className="w-full sm:ml-auto sm:w-auto"
                    onClick={() => setExpanded((open) => !open)}
                    aria-expanded={expanded}
                    aria-controls={detailsId}
                >
                    {expanded ? "Hide" : "Show"}
                    <ChevronDown className={cn("transition-transform", expanded && "rotate-180")} />
                </Button>
            </div>

            {expanded && (
                // Indented to the text column, the width of the icon plus its gap.
                <ul id={detailsId} className="mt-3 divide-y divide-border/60 border-t border-border/60 sm:ml-12">
                    {invitations.map((invitation) => (
                        <li key={invitation.id} className="flex min-w-0 flex-col gap-2 py-2.5 last:pb-0 sm:flex-row sm:items-center sm:gap-4">
                            <div className="min-w-0 flex-1 space-y-1">
                                <div className="flex min-w-0 items-center gap-2">
                                    <GroupTag group={invitation.group} className="shrink-0" />
                                    <span className={cn("min-w-0 truncate text-sm", !invitation.note && "text-muted-foreground")}>{invitation.note || "No note"}</span>
                                </div>
                                <p className="truncate text-xs text-muted-foreground">
                                    {invitation.createdByName ? `${invitation.createdByName} made it ` : "Made "}
                                    <RelativeTime date={invitation.createdAt} /> · runs out <RelativeTime date={invitation.expiresAt} />
                                </p>
                            </div>
                            {canManage && (
                                <Button variant="ghost-destructive" size="sm" className="self-start sm:self-auto" onClick={() => setRevoking(invitation)}>
                                    <Undo2 />
                                    Revoke
                                </Button>
                            )}
                        </li>
                    ))}
                </ul>
            )}

            {revoking && (
                <RevokeDialog
                    invitation={revoking}
                    onClose={() => setRevoking(null)}
                    onRevoked={() => {
                        setRevoking(null);
                        onRevoked();
                    }}
                />
            )}
        </div>
    );
}

/** Asks before a link is taken back. It keeps the dialog open with a spinner until the server answered. */
function RevokeDialog({ invitation, onClose, onRevoked }: { invitation: InvitationRow; onClose: () => void; onRevoked: () => void }) {
    const [pending, setPending] = useState(false);
    const subject = invitation.note ? `The link for ${invitation.note}` : "The link";

    const confirm = async () => {
        setPending(true);
        try {
            const result = await revokeInvitation(invitation.id);
            if (result.success) {
                toast.success("Invitation revoked");
                onRevoked();
                return;
            }
            // Most likely used or revoked meanwhile, so the list loads again.
            toast.error(result.error || "The invitation could not be revoked.");
            onRevoked();
            return;
        } catch (error) {
            // Without the right to change users the action throws instead of answering.
            log.warn("Revoking an invitation failed", { invitationId: invitation.id }, wrapError(error));
            toast.error("The invitation could not be revoked.");
        }
        setPending(false);
    };

    return (
        <ConfirmDialog
            open
            onOpenChange={(open) => !open && !pending && onClose()}
            title="Revoke this invitation?"
            note="The link stops working at once"
            icon={Undo2}
            description={`${subject} to join with the group ${invitation.group.name} stops working. Nobody used it yet, so nobody loses access. Make a new one if they still need it.`}
            confirmLabel="Revoke invitation"
            destructive
            isPending={pending}
            onConfirm={() => void confirm()}
        />
    );
}
