import { Copy, Pencil, Trash } from "lucide-react";
import type { BackupActionGroup } from "@/components/dashboard/storage/explorer/backup-actions";
import type { GroupRow } from "@/services/user/groups-types";

/** The viewer is in the group in the open tenant, and nobody changes or deletes the group they are in. */
export const isOwnGroup = (group: Pick<GroupRow, "members">) => group.members.some((member) => member.isYou);

/** Whether a viewer who may change groups changes this one: never the group with every permission, one the platform gives, or their own. */
export const isEditable = (group: Pick<GroupRow, "superAdmin" | "members" | "fromPlatform">) => !group.superAdmin && !group.fromPlatform && !isOwnGroup(group);

export interface GroupActionHandlers {
    onEdit?: (group: GroupRow) => void;
    onDuplicate?: (group: GroupRow) => void;
    onDelete?: (group: GroupRow) => void;
}

/**
 * Everything one group can do, as data, for the button at the end of the row, the right click
 * menu, the cards and the panel. Actions the viewer may not take have no handler and are left
 * out, and neither the group with every permission nor the group of the viewer is edited or deleted. The
 * panel shows Edit and Duplicate as buttons of their own, so `inPanel` leaves them out.
 */
export function groupActions(group: GroupRow, handlers: GroupActionHandlers, inPanel = false, platformName = "the platform"): BackupActionGroup[] {
    const { onEdit, onDuplicate, onDelete } = handlers;
    // A group the platform gives shows Edit and Delete, off, with who does them.
    const platform = group.fromPlatform && !group.superAdmin;
    const manage = inPanel
        ? []
        : [
              ...(onEdit && isEditable(group) ? [{ id: "edit", label: "Edit", icon: Pencil, onSelect: () => onEdit(group), tone: "edit" as const }] : []),
              ...(onEdit && platform ? [{ id: "edit", label: "Edit", icon: Pencil, onSelect: () => undefined, disabled: true, note: `${platformName} changes it`, tone: "edit" as const }] : []),
              ...(onDuplicate ? [{ id: "duplicate", label: "Duplicate", icon: Copy, onSelect: () => onDuplicate(group), tone: "create" as const }] : []),
          ];
    const remove = onDelete && isEditable(group)
        ? [{ id: "delete", label: "Delete", icon: Trash, onSelect: () => onDelete(group), tone: "destructive" as const }]
        : onDelete && platform
          ? [{ id: "delete", label: "Delete", icon: Trash, onSelect: () => undefined, disabled: true, note: `Only ${platformName} takes it away`, tone: "destructive" as const }]
          : [];
    return [
        ...(manage.length > 0 ? [{ label: "Manage", actions: manage }] : []),
        ...(remove.length > 0 ? [{ actions: remove }] : []),
    ];
}
