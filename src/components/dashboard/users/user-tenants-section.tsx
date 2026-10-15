"use client";

import { useState } from "react";
import { Building2, Loader2, Plus, TriangleAlert, UserMinus } from "lucide-react";
import { toast } from "sonner";
import { setTenantMember } from "@/app/actions/tenant/members";
import { Section } from "@/components/adapter/connection-details-sections";
import { TenantTileMark } from "@/components/tenant/tenant-pick";
import { useTenantName, useTenantView } from "@/components/tenant/tenant-view";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { accessLine, summarizeAccess } from "@/lib/auth/access-summary";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { HOME_TENANT_ID } from "@/lib/tenant/home";
import type { UserRow, UsersGroup } from "@/services/user/users-types";
import { groupsOfTenant } from "./user-access";
import { GroupPicker } from "./user-group-picker";
import { TenantField } from "./user-tenant-field";
import { namedTenants, type NamedTenantRole } from "./user-tenants";

const log = logger.child({ component: "user-tenants-section" });

interface UserTenantsSectionProps {
    /** A row of All tenants, which names every tenant of the account. */
    user: UserRow;
    groups: UsersGroup[];
    /** A platform admin who may change users gives and takes the group of each tenant. */
    canManage: boolean;
    onChanged: () => void;
}

/**
 * The tenants of an account on the list of every account, in place of the access of one group:
 * each tenant with the group there, picked from the groups of that tenant, Remove from the tenant,
 * and Add to a tenant with one of its groups. Each change is one membership, written into the log
 * of that tenant. Only a platform admin makes it, who manages every tenant, so a tenant may be left
 * without anyone else who manages its members, or without members at all.
 */
export function UserTenantsSection({ user, groups, canManage, onChanged }: UserTenantsSectionProps) {
    const nameOf = useTenantName();
    const { tenants } = useTenantView();
    const roles = namedTenants(user.tenants ?? [], nameOf);
    const [busy, setBusy] = useState<string | null>(null);
    const [removing, setRemoving] = useState<NamedTenantRole | null>(null);
    const [adding, setAdding] = useState(false);
    const [newTenant, setNewTenant] = useState("");
    const [newGroup, setNewGroup] = useState("");

    const open = tenants.filter((tenant) => !roles.some((role) => role.tenantId === tenant.id));

    /** Gives the group in a tenant, or takes the account out of it with null. True when it went through. */
    const save = async (tenantId: string, groupId: string | null, done: string): Promise<boolean> => {
        setBusy(tenantId);
        try {
            const result = await setTenantMember(tenantId, user.id, groupId);
            if (!result.success) {
                toast.error(result.error);
                return false;
            }
            toast.success(done);
            onChanged();
            return true;
        } catch (error: unknown) {
            // Anyone but a platform admin is refused with a throw.
            log.warn("Changing a tenant of a user failed", { userId: user.id, tenantId }, wrapError(error));
            toast.error("The tenant could not be changed.");
            return false;
        } finally {
            setBusy(null);
        }
    };

    const add = async () => {
        const tenantName = nameOf(newTenant) ?? "the tenant";
        if (await save(newTenant, newGroup, `${user.name} works in ${tenantName} now`)) {
            setAdding(false);
            setNewTenant("");
            setNewGroup("");
        }
    };

    const aside = canManage && open.length > 0 && !adding ? (
        <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1 rounded-sm font-medium text-foreground outline-none hover:underline hover:underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring/50"
        >
            <Plus className="size-3.5" aria-hidden="true" />
            Add to a tenant
        </button>
    ) : roles.length > 0 ? `${roles.length} ${roles.length === 1 ? "tenant" : "tenants"}` : undefined;

    return (
        <Section title="Tenants" aside={aside}>
            {roles.length === 0 && (
                <div className="relative flex gap-3 overflow-hidden rounded-lg border border-warning/30 bg-warning/5 p-3 pl-4">
                    <span className="absolute inset-y-0 left-0 w-1 bg-warning" aria-hidden="true" />
                    <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
                    <div className="min-w-0 space-y-1 text-sm">
                        <p className="font-medium">In no tenant</p>
                        <p className="text-muted-foreground">Signs in, but sees and does nothing until someone adds them to a tenant.</p>
                    </div>
                </div>
            )}

            {roles.length > 0 && (
                <ul className="divide-y border-y">
                    {roles.map((role) => {
                        const group = groups.find((entry) => entry.id === role.group.id);
                        const offered = groupsOfTenant(groups, role.tenantId);
                        return (
                            <li key={role.tenantId} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
                                <TenantTileMark name={role.tenantName} className="size-8 rounded-lg" />
                                <div className="min-w-0 flex-1">
                                    <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
                                        <span className="truncate">{role.tenantName}</span>
                                        {role.tenantId === HOME_TENANT_ID && <span className="shrink-0 text-xs font-normal text-muted-foreground">Home</span>}
                                    </div>
                                    <div className="truncate text-xs text-muted-foreground">
                                        {group ? accessLine(summarizeAccess(group.permissions, group.superAdmin)) : role.group.name}
                                    </div>
                                </div>
                                {canManage ? (
                                    <div className="flex w-full min-w-0 items-center gap-2 sm:w-56">
                                        <div className="min-w-0 flex-1">
                                            <GroupPicker
                                                groups={offered}
                                                viewerPlatformAdmin
                                                allowNone={false}
                                                value={role.group.id}
                                                disabled={busy !== null}
                                                aria-label={`Group in ${role.tenantName}`}
                                                onChange={(groupId) => {
                                                    if (groupId === role.group.id) return;
                                                    const name = groups.find((entry) => entry.id === groupId)?.name ?? "the group";
                                                    void save(role.tenantId, groupId, `${user.name} is in ${name} in ${role.tenantName} now`);
                                                }}
                                            />
                                        </div>
                                        <Button
                                            variant="ghost-destructive"
                                            size="icon-sm"
                                            className="shrink-0"
                                            disabled={busy !== null}
                                            onClick={() => setRemoving(role)}
                                            aria-label={`Remove from ${role.tenantName}`}
                                        >
                                            {busy === role.tenantId ? <Loader2 className="animate-spin" /> : <UserMinus />}
                                        </Button>
                                    </div>
                                ) : (
                                    <span className="shrink-0 text-sm">{role.group.name}</span>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}

            {adding && (
                <div className="space-y-2 rounded-lg border p-3">
                    <p className="flex items-center gap-2 text-sm font-medium">
                        <Building2 className="size-4 text-muted-foreground" aria-hidden="true" />
                        Add to a tenant
                    </p>
                    <div className="grid gap-2 sm:grid-cols-2">
                        <TenantField
                            tenants={open}
                            value={newTenant}
                            onChange={(tenantId) => {
                                // A group belongs to its tenant, so a pick of another tenant starts the group anew.
                                if (tenantId !== newTenant) setNewGroup("");
                                setNewTenant(tenantId);
                            }}
                            aria-label="The tenant"
                        />
                        <GroupPicker
                            groups={newTenant ? groupsOfTenant(groups, newTenant) : []}
                            viewerPlatformAdmin
                            allowNone={false}
                            value={newGroup}
                            onChange={setNewGroup}
                            disabled={!newTenant}
                            aria-label="The group in the tenant"
                        />
                    </div>
                    <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => setAdding(false)}>Cancel</Button>
                        <Button tone="create" size="sm" disabled={!newTenant || !newGroup || busy !== null} onClick={() => void add()}>
                            {busy === newTenant && <Loader2 className="animate-spin" />}
                            Add
                        </Button>
                    </div>
                </div>
            )}

            {removing && (
                <ConfirmDialog
                    open
                    onOpenChange={(next) => !next && setRemoving(null)}
                    title={`Remove ${user.name} from ${removing.tenantName}?`}
                    note="They lose what the group gave them there"
                    icon={UserMinus}
                    description={`${user.name} no longer sees ${removing.tenantName}. Their account and their other tenants stay as they are.`}
                    confirmLabel={`Remove from ${removing.tenantName}`}
                    destructive
                    isPending={busy === removing.tenantId}
                    onConfirm={async () => {
                        if (await save(removing.tenantId, null, `${user.name} no longer works in ${removing.tenantName}`)) setRemoving(null);
                    }}
                />
            )}
        </Section>
    );
}
