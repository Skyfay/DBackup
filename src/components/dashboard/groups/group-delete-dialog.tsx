"use client";

import { useState } from "react";
import { Trash } from "lucide-react";
import { toast } from "sonner";
import { deleteGroup } from "@/app/actions/auth/group";
import { ChoiceCards, type ModeOption } from "@/components/adapter/connection-mode-choice";
import { NO_GROUP } from "@/components/dashboard/users/user-columns";
import { listed } from "@/components/dashboard/users/user-strip";
import { ConfirmDialog, DialogItemList } from "@/components/ui/confirm-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import type { GroupRow } from "@/services/user/groups-types";
import { countWord } from "./group-cells";
import { groupLine } from "./group-columns";

const log = logger.child({ component: "group-delete-dialog" });

/** Where members can go: every other group with what it lets them do, the SuperAdmin group only for a SuperAdmin, or none. */
export function groupTargets(groups: GroupRow[], exceptId: string | null, viewerSuperAdmin: boolean): ModeOption[] {
    return [
        ...groups
            .filter((group) => group.id !== exceptId && (!group.superAdmin || viewerSuperAdmin))
            .map((group) => ({ value: group.id, title: group.name, description: groupLine(group) })),
        { value: NO_GROUP, title: "No group", description: "They sign in, but see and do nothing" },
    ];
}

interface GroupDeleteDialogProps {
    group: GroupRow;
    groups: GroupRow[];
    viewerSuperAdmin: boolean;
    onClose: () => void;
    onDeleted: () => void;
}

/**
 * Deletes a group after asking. A group with members asks which group they move to, so nobody
 * is left without access by surprise, and the button waits for the pick.
 */
export function GroupDeleteDialog({ group, groups, viewerSuperAdmin, onClose, onDeleted }: GroupDeleteDialogProps) {
    const [moveTo, setMoveTo] = useState("");
    const [pending, setPending] = useState(false);
    const members = group.members;
    const names = members.map((member) => member.name);

    const confirm = async () => {
        setPending(true);
        try {
            const result = await deleteGroup(group.id, members.length > 0 && moveTo !== NO_GROUP ? moveTo : null);
            if (result.success) {
                toast.success(members.length > 0 ? `${group.name} deleted, ${countWord(members.length, "person", "people")} moved` : `${group.name} deleted`);
                onDeleted();
                return;
            }
            toast.error(result.error || "The group could not be deleted.");
        } catch (error) {
            // Without the right to change groups the action throws instead of answering.
            log.warn("Deleting a group failed", { groupId: group.id }, wrapError(error));
            toast.error("The group could not be deleted.");
        }
        setPending(false);
    };

    return (
        <ConfirmDialog
            open
            onOpenChange={(open) => !open && onClose()}
            title={`Delete ${group.name}?`}
            note="Cannot be undone"
            icon={Trash}
            description={
                members.length > 0
                    ? `${listed(names)} ${members.length === 1 ? "is" : "are"} in it. Pick the group they move to, since without one they sign in and see nothing.`
                    : "Nobody is in it, so no one loses access."
            }
            confirmLabel={members.length > 0 ? `Delete and move ${countWord(members.length, "person", "people")}` : "Delete group"}
            destructive
            disabled={members.length > 0 && !moveTo}
            isPending={pending}
            onConfirm={confirm}
            className={members.length > 0 ? "sm:max-w-xl" : undefined}
        >
            {members.length > 0 && (
                <>
                    <DialogItemList items={members.map((member) => ({ name: member.name, detail: member.email }))} size="small" />
                    <div className="space-y-2">
                        <p className="text-sm font-medium">They move to</p>
                        <ScrollArea className="*:data-[slot=scroll-area-viewport]:max-h-72">
                            <ChoiceCards value={moveTo} onValueChange={setMoveTo} options={groupTargets(groups, group.id, viewerSuperAdmin)} aria-label="The group they move to" />
                        </ScrollArea>
                        <p className="text-xs text-muted-foreground">The audit log keeps the group and who was in it.</p>
                    </div>
                </>
            )}
        </ConfirmDialog>
    );
}
