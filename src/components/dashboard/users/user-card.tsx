"use client";

import { useTenantName } from "@/components/tenant/tenant-view";
import { isPlainClick } from "@/components/ui/row-click";
import type { UserRow } from "@/services/user/users-types";
import { GroupTag, LastSignInCell, MethodsCell, PlatformAdminTag, SecondFactorCell, UserAvatar, YouTag } from "./user-cells";
import { TenantsCell } from "./user-tenants";

interface UserCardProps {
    user: UserRow;
    onOpen: (user: UserRow) => void;
    actions: React.ReactNode;
}

/** A user on a phone: who they are, their group or in All tenants their tenants, how they sign in and when they last did. */
export function UserCard({ user, onOpen, actions }: UserCardProps) {
    const tenantName = useTenantName();
    return (
        <div
            onClick={(event) => isPlainClick(event) && onOpen(user)}
            className="flex min-w-0 cursor-pointer flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground shadow-sm transition-colors hover:border-foreground/20 group-data-[state=open]/row:border-foreground/20"
        >
            <div className="flex items-start gap-3">
                <UserAvatar user={user} size="lg" />
                <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-1.5">
                        <button
                            type="button"
                            onClick={() => onOpen(user)}
                            className="block min-w-0 truncate rounded-sm text-left font-semibold outline-none hover:underline hover:underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring/50"
                        >
                            {user.name}
                        </button>
                        {user.superAdmin && <PlatformAdminTag />}
                        {user.isYou && <YouTag />}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                </div>
                <div className="-mt-1 -mr-2">{actions}</div>
            </div>
            <div className="flex min-w-0 items-center gap-3">
                {user.tenants ? <TenantsCell tenants={user.tenants} nameOf={tenantName} className="min-w-0" /> : <GroupTag group={user.group} />}
                <SecondFactorCell value={user.secondFactor} />
            </div>
            <MethodsCell methods={user.methods} />
            <div className="border-t pt-3">
                <LastSignInCell user={user} />
            </div>
        </div>
    );
}
