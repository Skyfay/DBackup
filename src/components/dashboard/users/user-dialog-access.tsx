"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { setUserPlatformGroup } from "@/app/actions/auth/platform-group";
import { setTenantMember } from "@/app/actions/tenant/members";
import { asksFirst, NO_PLATFORM_GROUP, platformChoiceOf, platformGroupLock, platformGroupNote, platformGroupOf, PlatformGroupPick } from "@/components/dashboard/platform/user-platform-group";
import { useTenantName } from "@/components/tenant/tenant-view";
import { usePageModel } from "@/hooks/use-page-model";
import { PLATFORM_ADMIN_GROUP_ID, type PlatformGroupsModel } from "@/services/user/platform-groups-types";
import type { UserRow, UsersGroup } from "@/services/user/users-types";
import { TenantRolesField } from "./user-tenant-roles-field";
import { draftsOf, tenantChangeLine, tenantRoleChanges, type TenantRoleDraft } from "./user-tenant-roles";

/**
 * The access of an account in Edit user of All tenants, held until Save: its platform group and
 * its group in each tenant. Save writes the platform group first, then one membership after the
 * other, each like a change in the panel, and stops at the first refusal.
 */

export interface AccessEdit {
    /** The picked platform group, as `PlatformGroupPick` names it. */
    platform: string;
    roles: TenantRoleDraft[];
}

/** What the dialog shows and saves of the access, and why the viewer may not change a part of it. */
export interface AccessParts {
    platform: boolean;
    tenants: boolean;
    platformLock: string | null;
    tenantLock: string | null;
}

/** The access of an account as the dialog starts with it. */
export const accessOf = (user: UserRow): AccessEdit => ({ platform: platformGroupOf(user), roles: draftsOf(user.tenants ?? []) });

/** Whether Save changes the platform group, and whether that asks first, since it gives or ends the platform admin role. */
export function platformChange(user: UserRow, edit: AccessEdit, parts: AccessParts): { changes: boolean; asks: boolean } {
    const changes = parts.platform && parts.platformLock === null && edit.platform !== platformGroupOf(user);
    return { changes, asks: changes && asksFirst(user, edit.platform) };
}

/**
 * Writes what changed of the access, the platform group first. False at the first refusal, which
 * shows as a toast, with what went through before it kept.
 */
export async function saveAccess(user: UserRow, edit: AccessEdit, parts: AccessParts): Promise<boolean> {
    if (platformChange(user, edit, parts).changes) {
        const result = await setUserPlatformGroup(user.id, platformChoiceOf(edit.platform));
        if (!result.success) {
            toast.error(result.error);
            return false;
        }
    }
    if (parts.tenants && parts.tenantLock === null) {
        for (const change of tenantRoleChanges(user.tenants ?? [], edit.roles)) {
            const result = await setTenantMember(change.tenantId, user.id, change.groupId);
            if (!result.success) {
                toast.error(result.error);
                return false;
            }
        }
    }
    return true;
}

/** What Edit of an account in All tenants changes, in the head of the dialog. */
export function accessNote(parts: AccessParts, accountLocked: boolean): string {
    const more = [...(parts.platform ? ["the platform group"] : []), ...(parts.tenants ? ["the tenants"] : [])];
    if (accountLocked) return more.length === 0 ? "Read only, the account is not yours to change" : `Only ${more.join(" and ")}`;
    return more.length === 0 ? "The name and the email, the panel shows the group of each tenant" : `The name, the email, ${more.join(" and ")}`;
}

interface AccessEditOptions {
    open: boolean;
    user: UserRow | null;
    allTenants: boolean;
    manageTenants: boolean;
    managePlatformGroup: boolean;
    viewerPlatformAdmin: boolean;
}

/**
 * The access part of Edit user: in All tenants, for whoever may change them, the platform group and
 * the tenants, started from the account each time the dialog opens, and the line for its foot.
 */
export function useAccessEdit({ open, user, allTenants, manageTenants, managePlatformGroup, viewerPlatformAdmin }: AccessEditOptions) {
    const nameOf = useTenantName();
    const withAccess = user !== null && allTenants;
    const withPlatform = withAccess && managePlatformGroup && user.platformGroup !== undefined;
    const { model: platformModel } = usePageModel<PlatformGroupsModel>(open && withPlatform ? "/api/platform/platform-groups" : null, "The platform groups could not be loaded.");
    const [access, setAccess] = useState<AccessEdit>({ platform: "", roles: [] });

    useEffect(() => {
        if (open && user) setAccess(accessOf(user));
    }, [open, user]);

    // The own tenants and those of a platform admin are a platform admin's to change, like the server checks it.
    const parts: AccessParts = {
        platform: withPlatform,
        tenants: withAccess && manageTenants && user.tenants !== undefined,
        platformLock: user && withPlatform ? platformGroupLock(user, platformModel) : null,
        tenantLock: user && !viewerPlatformAdmin
            ? user.isYou ? "Another admin changes your own tenants." : user.superAdmin ? "Only a platform admin changes the tenants of a platform admin." : null
            : null,
    };
    const tenantsLine = user && parts.tenants ? tenantChangeLine(tenantRoleChanges(user.tenants ?? [], access.roles), user.tenants ?? [], nameOf) : null;
    const line = user && withAccess ? [...(platformChange(user, access, parts).changes ? ["Another platform group"] : []), ...(tenantsLine ? [tenantsLine] : [])].join(", ") : "";
    return { withAccess, parts, platformModel, access, setAccess, line };
}

interface UserAccessFieldsProps {
    user: UserRow;
    groups: UsersGroup[];
    platformModel: PlatformGroupsModel | null;
    parts: AccessParts;
    value: AccessEdit;
    onChange: (next: AccessEdit) => void;
    disabled: boolean;
}

/** The platform group and the tenants of an account, below its name and email in Edit user. */
export function UserAccessFields({ user, groups, platformModel, parts, value, onChange, disabled }: UserAccessFieldsProps) {
    return (
        <>
            {parts.platform && (
                <section className="space-y-2" aria-labelledby="user-platform-group">
                    <h3 id="user-platform-group" className="text-sm font-medium">Platform group</h3>
                    <PlatformGroupPick
                        user={user}
                        model={platformModel}
                        value={value.platform}
                        onPick={(platform) => onChange({ ...value, platform })}
                        disabled={disabled || parts.platformLock !== null}
                    />
                    <p className="text-xs text-muted-foreground">
                        {parts.platformLock ?? platformGroupNote({ superAdmin: value.platform === PLATFORM_ADMIN_GROUP_ID }, platformModel?.groups.find((group) => group.id === value.platform))}
                    </p>
                </section>
            )}
            {parts.tenants && (
                <TenantRolesField
                    before={user.tenants ?? []}
                    value={value.roles}
                    onChange={(roles) => onChange({ ...value, roles })}
                    groups={groups}
                    lock={parts.tenantLock}
                    platform={value.platform !== NO_PLATFORM_GROUP}
                    disabled={disabled}
                />
            )}
        </>
    );
}
