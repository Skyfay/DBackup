"use client";

import { Loader2, ShieldCheck, UserMinus } from "lucide-react";
import type { TenantMembersData } from "@/app/actions/tenant/members";
import { PlatformAdminConfirmDialog, platformAdminAction } from "@/components/dashboard/platform/platform-admin-role";
import { BackupRowMenu } from "@/components/dashboard/storage/explorer/backup-menus";
import type { BackupActionGroup } from "@/components/dashboard/storage/explorer/backup-actions";
import { UserAvatar, YouTag } from "@/components/dashboard/users/user-cells";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { TenantMember } from "@/services/tenant/membership-service";
import { TenantGroupPicker } from "./tenant-pickers";

/** A change of a member that asks first. */
export type MemberConfirm = { kind: "remove"; member: TenantMember } | { kind: "admin"; member: TenantMember; on: boolean };

interface MemberRowProps {
    member: TenantMember;
    tenantName: string;
    groups: TenantMembersData["groups"];
    isViewer: boolean;
    /** May move and remove the member. Otherwise the row names the group. */
    canManage?: boolean;
    /** Only a platform admin makes someone one or takes it back. */
    viewerPlatformAdmin?: boolean;
    busy: boolean;
    onGroup: (member: TenantMember, groupId: string) => void;
    onConfirm: (confirm: MemberConfirm) => void;
}

/** The menu of a member: the platform admin role for a platform admin, never for the viewer, and Remove. */
function memberActions(member: TenantMember, tenantName: string, isViewer: boolean, viewerPlatformAdmin: boolean, onConfirm: (confirm: MemberConfirm) => void): BackupActionGroup[] {
    const groups: BackupActionGroup[] = [];
    if (!isViewer && viewerPlatformAdmin) {
        groups.push({ actions: [platformAdminAction(member.platformAdmin, () => onConfirm({ kind: "admin", member, on: !member.platformAdmin }))] });
    }
    groups.push({ actions: [{ id: "remove", label: `Remove from ${tenantName}`, icon: UserMinus, onSelect: () => onConfirm({ kind: "remove", member }), tone: "destructive" }] });
    return groups;
}

/** One member with their group in the tenant, which changes at once, and a menu for the rest. */
export function MemberRow({ member, tenantName, groups, isViewer, canManage = true, viewerPlatformAdmin = true, busy, onGroup, onConfirm }: MemberRowProps) {
    // Someone of a platform group never changes their own membership or that of a platform admin.
    const changeable = canManage && (viewerPlatformAdmin || (!isViewer && !member.platformAdmin));
    return (
        <li className="flex flex-col gap-2.5 px-5 py-3 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 items-center gap-3">
                <UserAvatar user={member} />
                <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-sm font-medium">{member.name || member.email}</span>
                        {isViewer && <YouTag />}
                        {member.platformAdmin && (
                            <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-muted-foreground">
                                <ShieldCheck className="size-3" aria-hidden="true" />
                                Platform admin
                            </span>
                        )}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{member.email}</p>
                </div>
            </div>
            <div className="flex min-w-0 items-center gap-1.5 pl-11 sm:pl-0">
                {busy && <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" aria-label="Saving" />}
                {changeable ? (
                    <>
                        <TenantGroupPicker
                            groups={groups}
                            value={member.group.id}
                            onChange={(groupId) => groupId !== member.group.id && onGroup(member, groupId)}
                            note={`What ${member.name || member.email} may do in ${tenantName}`}
                            aria-label={`Group of ${member.name || member.email}: ${member.group.name}`}
                            disabled={busy}
                            className="sm:w-48 sm:flex-none"
                        />
                        <BackupRowMenu name={member.name || member.email} groups={memberActions(member, tenantName, isViewer, viewerPlatformAdmin, onConfirm)} />
                    </>
                ) : (
                    <span className="truncate text-sm">{member.group.name}</span>
                )}
            </div>
        </li>
    );
}

interface MemberConfirmDialogProps {
    confirm: MemberConfirm;
    tenantName: string;
    pending: boolean;
    onClose: () => void;
    onConfirm: (confirm: MemberConfirm) => void;
}

/** Asks before someone leaves the tenant, or before the platform admin role changes. */
export function MemberConfirmDialog({ confirm, tenantName, pending, onClose, onConfirm }: MemberConfirmDialogProps) {
    const name = confirm.member.name || confirm.member.email;
    const common = { open: true, onOpenChange: (open: boolean) => !open && onClose(), isPending: pending, onConfirm: () => onConfirm(confirm) };

    if (confirm.kind === "remove") {
        return (
            <ConfirmDialog
                {...common}
                icon={UserMinus}
                destructive
                title={`Remove ${name} from ${tenantName}?`}
                note="The account stays"
                description={`${name} no longer opens ${tenantName}. The account, its sign-ins and its other tenants stay as they are.${confirm.member.platformAdmin ? " As a platform admin they still open every tenant." : ""}`}
                confirmLabel="Remove"
            />
        );
    }
    return <PlatformAdminConfirmDialog name={name} on={confirm.on} tenantName={tenantName} pending={pending} onClose={onClose} onConfirm={() => onConfirm(confirm)} />;
}
