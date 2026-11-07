import { ArrowRightLeft, Copy, Eye, Pencil, Trash } from "lucide-react";
import type { BackupActionGroup } from "@/components/dashboard/storage/explorer/backup-actions";
import type { GroupRow } from "@/services/user/groups-types";
import { isBuiltInRow, isTemplateRow } from "./tenant-group-template-model";

export interface TenantGroupHandlers {
    /** Opens a group for tenants in its editor, read only when the viewer may not change it. */
    onOpen: (group: GroupRow) => void;
    onDuplicate?: (group: GroupRow) => void;
    onDelete?: (group: GroupRow) => void;
    /** Switches into the tenant of its own group and shows it there, absent where the viewer may not open that tenant. */
    onOpenInTenant?: (group: GroupRow) => void;
}

/**
 * What a row of the tenant groups can have done to it, for the button at the end of the row and
 * the right click. A group for tenants is edited or viewed, duplicated and deleted here, the
 * built-in Admin never changes, and the own group of a tenant opens in its tenant, where it changes.
 */
export function tenantGroupActions(group: GroupRow, handlers: TenantGroupHandlers, editable: boolean): BackupActionGroup[] {
    const { onOpen, onDuplicate, onDelete, onOpenInTenant } = handlers;
    if (isBuiltInRow(group)) {
        // Only someone who manages the groups for tenants is told why Admin stays as it is.
        return onDelete ? [
            { label: "Manage", actions: [{ id: "edit", label: "Edit", icon: Pencil, onSelect: () => undefined, disabled: true, note: "Built in, never changes", tone: "edit" }] },
            { actions: [{ id: "delete", label: "Delete", icon: Trash, onSelect: () => undefined, disabled: true, note: "Every tenant keeps its Admin", tone: "destructive" }] },
        ] : [];
    }
    if (isTemplateRow(group)) {
        const open = editable
            ? { id: "edit", label: "Edit", icon: Pencil, onSelect: () => onOpen(group), tone: "edit" as const }
            : { id: "view", label: "View", icon: Eye, onSelect: () => onOpen(group), tone: "neutral" as const };
        return [
            { label: "Manage", actions: [open, ...(onDuplicate ? [{ id: "duplicate", label: "Duplicate", icon: Copy, onSelect: () => onDuplicate(group), tone: "create" as const }] : [])] },
            ...(onDelete && editable ? [{ actions: [{ id: "delete", label: "Delete", icon: Trash, onSelect: () => onDelete(group), tone: "destructive" as const }] }] : []),
        ];
    }
    return onOpenInTenant
        ? [{ actions: [{ id: "open-in-tenant", label: "Open in its tenant", icon: ArrowRightLeft, onSelect: () => onOpenInTenant(group), note: "Its tenant changes it", tone: "neutral" }] }]
        : [];
}
