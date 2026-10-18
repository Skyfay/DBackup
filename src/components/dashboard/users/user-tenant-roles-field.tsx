"use client";

import { useState } from "react";
import { Building2, Plus, RotateCcw, TriangleAlert, UserMinus } from "lucide-react";
import { TenantTileMark } from "@/components/tenant/tenant-pick";
import { useTenantName, useTenantView } from "@/components/tenant/tenant-view";
import { Button } from "@/components/ui/button";
import { accessLine, summarizeAccess } from "@/lib/auth/access-summary";
import { HOME_TENANT_ID } from "@/lib/tenant/home";
import { cn } from "@/lib/utils";
import type { UserTenantRole, UsersGroup } from "@/services/user/users-types";
import { givableIn, type TenantReach } from "./user-access";
import { GroupPicker } from "./user-group-picker";
import { TenantField, tenantGroupsMeta } from "./user-tenant-field";
import { tenantRoleRows, type TenantRoleDraft, type TenantRoleState } from "./user-tenant-roles";

/** Every tenant and every group, for a platform admin. */
const EVERY_TENANT: TenantReach = { managedTenants: null, givableGroups: null };

const STATE_TAGS: Record<Exclude<TenantRoleState, "same">, { label: string; className: string }> = {
    new: { label: "Joins on save", className: "bg-success/10 text-success" },
    changed: { label: "Changed", className: "bg-tone/10 text-tone" },
    removed: { label: "Leaves on save", className: "bg-destructive/10 text-destructive" },
};

interface TenantRolesFieldProps {
    /** The tenants of the account now. */
    before: readonly UserTenantRole[];
    value: TenantRoleDraft[];
    onChange: (next: TenantRoleDraft[]) => void;
    groups: UsersGroup[];
    /** Why the viewer may not change them, which leaves them read only. */
    lock: string | null;
    /** Runs the platform, so no tenant is fine. */
    platform?: boolean;
    disabled?: boolean;
    /** The tenants and groups the viewer changes, those their platform group reaches. Every one when left out. */
    reach?: TenantReach;
}

/**
 * The tenants of an account in Edit user of All tenants: each tenant with its group, picked from
 * the groups of that tenant, Remove, and Add to a tenant with one of its groups. Nothing changes
 * before Save, and every row says what Save does there.
 */
export function TenantRolesField({ before, value, onChange, groups, lock, platform = false, disabled = false, reach = EVERY_TENANT }: TenantRolesFieldProps) {
    const nameOf = useTenantName();
    const { tenants } = useTenantView();
    const [adding, setAdding] = useState(false);
    const [newTenant, setNewTenant] = useState("");
    const [newGroup, setNewGroup] = useState("");
    const rows = tenantRoleRows(before, value, nameOf);
    const kept = new Set(value.map((role) => role.tenantId));
    // Only the tenants the viewer looks after, with the groups they may give there, like the server checks it.
    const open = tenants.filter((tenant) => !kept.has(tenant.id) && givableIn(groups, tenant.id, reach).length > 0);
    const locked = disabled || lock !== null;
    /** A tenant whose group the viewer may give and take, which a group beyond them stays out of. */
    const changeable = (tenantId: string) => {
        const offered = givableIn(groups, tenantId, reach);
        const held = before.find((role) => role.tenantId === tenantId)?.group.id;
        return offered.length > 0 && (!held || offered.some((group) => group.id === held));
    };

    const setGroup = (tenantId: string, groupId: string) => onChange(value.map((role) => (role.tenantId === tenantId ? { ...role, groupId } : role)));
    const remove = (tenantId: string) => onChange(value.filter((role) => role.tenantId !== tenantId));
    const keep = (tenantId: string, groupId: string) => onChange([...value, { tenantId, groupId }]);
    const add = () => {
        onChange([...value.filter((role) => role.tenantId !== newTenant), { tenantId: newTenant, groupId: newGroup }]);
        setAdding(false);
        setNewTenant("");
        setNewGroup("");
    };

    return (
        <section className="space-y-2" aria-labelledby="user-tenant-roles">
            <div className="flex items-baseline justify-between gap-3">
                <h3 id="user-tenant-roles" className="text-sm font-medium">Tenants</h3>
                {!locked && open.length > 0 && !adding && (
                    <button
                        type="button"
                        onClick={() => setAdding(true)}
                        className="inline-flex items-center gap-1 rounded-sm text-xs font-medium outline-none hover:underline hover:underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring/50"
                    >
                        <Plus className="size-3.5" aria-hidden="true" />
                        Add to a tenant
                    </button>
                )}
            </div>

            {rows.length === 0 && !adding && platform && (
                <p className="text-sm text-muted-foreground">Works in no tenant of its own. Its platform group decides which tenants it opens.</p>
            )}
            {rows.length === 0 && !adding && !platform && (
                <div className="relative flex gap-3 overflow-hidden rounded-lg border border-warning/30 bg-warning/5 p-3 pl-4">
                    <span className="absolute inset-y-0 left-0 w-1 bg-warning" aria-hidden="true" />
                    <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
                    <div className="min-w-0 space-y-1 text-sm">
                        <p className="font-medium">In no tenant</p>
                        <p className="text-muted-foreground">Signs in, but sees and does nothing until they work in a tenant.</p>
                    </div>
                </div>
            )}

            {rows.length > 0 && (
                <ul className="divide-y rounded-lg border">
                    {rows.map((row) => {
                        const group = groups.find((entry) => entry.id === row.groupId);
                        const removed = row.state === "removed";
                        const tag = row.state === "same" ? null : STATE_TAGS[row.state];
                        return (
                            <li key={row.tenantId} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
                                <TenantTileMark name={row.tenantName} className={cn("size-8 rounded-lg", removed && "opacity-50")} />
                                <div className="min-w-0 flex-1">
                                    <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
                                        <span className={cn("truncate", removed && "text-muted-foreground line-through")}>{row.tenantName}</span>
                                        {row.tenantId === HOME_TENANT_ID && <span className="shrink-0 text-xs font-normal text-muted-foreground">Home</span>}
                                        {tag && <span className={cn("shrink-0 rounded-sm px-1.5 py-0.5 text-[11px] font-medium", tag.className)}>{tag.label}</span>}
                                    </div>
                                    <div className="truncate text-xs text-muted-foreground">
                                        {removed ? `Loses ${group?.name ?? "the group"} there` : group ? accessLine(summarizeAccess(group.permissions, group.superAdmin)) : "Pick a group"}
                                    </div>
                                </div>
                                {removed ? (
                                    <Button type="button" variant="ghost" size="sm" disabled={locked || !changeable(row.tenantId)} onClick={() => keep(row.tenantId, row.groupId)}>
                                        <RotateCcw />
                                        Keep
                                    </Button>
                                ) : (
                                    <div className="flex w-full min-w-0 items-center gap-2 sm:w-80">
                                        <div className="min-w-0 flex-1">
                                            <GroupPicker
                                                groups={changeable(row.tenantId) ? givableIn(groups, row.tenantId, reach) : groups.filter((entry) => entry.id === row.groupId)}
                                                // The groups are those the viewer may give in that tenant already, see `givableIn`.
                                                viewerPlatformAdmin
                                                allowNone={false}
                                                value={row.groupId}
                                                disabled={locked || !changeable(row.tenantId)}
                                                aria-label={`Group in ${row.tenantName}`}
                                                onChange={(groupId) => setGroup(row.tenantId, groupId)}
                                            />
                                        </div>
                                        <Button
                                            type="button"
                                            variant="ghost-destructive"
                                            size="icon-sm"
                                            className="shrink-0"
                                            disabled={locked || !changeable(row.tenantId)}
                                            onClick={() => remove(row.tenantId)}
                                            aria-label={`Remove from ${row.tenantName}`}
                                        >
                                            <UserMinus />
                                        </Button>
                                    </div>
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
                            metaOf={tenantGroupsMeta(groups)}
                            value={newTenant}
                            onChange={(tenantId) => {
                                // A group belongs to its tenant, so a pick of another tenant starts the group anew.
                                if (tenantId !== newTenant) setNewGroup("");
                                setNewTenant(tenantId);
                            }}
                            aria-label="The tenant"
                        />
                        <GroupPicker
                            groups={newTenant ? givableIn(groups, newTenant, reach) : []}
                            // The groups are those the viewer may give in that tenant already, see `givableIn`.
                            viewerPlatformAdmin
                            allowNone={false}
                            value={newGroup}
                            onChange={setNewGroup}
                            disabled={!newTenant}
                            aria-label="The group in the tenant"
                        />
                    </div>
                    <div className="flex justify-end gap-2">
                        <Button type="button" variant="ghost" size="sm" onClick={() => setAdding(false)}>Cancel</Button>
                        <Button type="button" tone="create" size="sm" disabled={!newTenant || !newGroup} onClick={add}>
                            <Plus />
                            Add
                        </Button>
                    </div>
                </div>
            )}

            <p className="text-xs text-muted-foreground">{lock ?? "A group per tenant, picked from the groups of that tenant. Nothing changes before Save."}</p>
        </section>
    );
}
