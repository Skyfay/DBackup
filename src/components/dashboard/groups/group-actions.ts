import { Copy, Pencil, Trash } from "lucide-react";
import type { BackupActionGroup } from "@/components/dashboard/storage/explorer/backup-actions";
import type { GroupRow } from "@/services/user/groups-types";

/** The viewer is in the group, and nobody changes or deletes the group they are in. */
export const isOwnGroup = (group: Pick<GroupRow, "members">) => group.members.some((member) => member.isYou);

/** Whether a viewer who may change groups changes this one: never the SuperAdmin group or their own. */
export const isEditable = (group: Pick<GroupRow, "superAdmin" | "members">) => !group.superAdmin && !isOwnGroup(group);

export interface GroupActionHandlers {
    onEdit?: (group: GroupRow) => void;
    onDuplicate?: (group: GroupRow) => void;
    onDelete?: (group: GroupRow) => void;
}

/**
 * Everything one group can do, as data, for the button at the end of the row, the right click
 * menu, the cards and the panel. Actions the viewer may not take have no handler and are left
 * out, and neither the SuperAdmin group nor the group of the viewer is edited or deleted. The
 * panel shows Edit and Duplicate as buttons of their own, so `inPanel` leaves them out.
 */
export function groupActions(group: GroupRow, handlers: GroupActionHandlers, inPanel = false): BackupActionGroup[] {
    const { onEdit, onDuplicate, onDelete } = handlers;
    const manage = inPanel
        ? []
        : [
              ...(onEdit && isEditable(group) ? [{ id: "edit", label: "Edit", icon: Pencil, onSelect: () => onEdit(group), tone: "edit" as const }] : []),
              ...(onDuplicate ? [{ id: "duplicate", label: "Duplicate", icon: Copy, onSelect: () => onDuplicate(group), tone: "create" as const }] : []),
          ];
    const remove = onDelete && isEditable(group) ? [{ id: "delete", label: "Delete", icon: Trash, onSelect: () => onDelete(group), tone: "destructive" as const }] : [];
    return [
        ...(manage.length > 0 ? [{ label: "Manage", actions: manage }] : []),
        ...(remove.length > 0 ? [{ actions: remove }] : []),
    ];
}
