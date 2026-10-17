"use client";

import { useCallback, useMemo, useState } from "react";
import { ArrowRightLeft, Loader2 } from "lucide-react";
import { GroupCard } from "@/components/dashboard/groups/group-card";
import { groupColumns } from "@/components/dashboard/groups/group-columns";
import { GroupsStrip } from "@/components/dashboard/groups/group-strip";
import { useTenantColumns } from "@/components/tenant/tenant-column";
import { withTenantColumn } from "@/components/tenant/tenant-rows";
import { useMayOpenTenant, useOpenInTenant } from "@/components/tenant/tenant-view";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { JOIN_END } from "@/components/ui/page-head";
import { Skeleton } from "@/components/ui/skeleton";
import { usePageModel } from "@/hooks/use-page-model";
import { cn } from "@/lib/utils";
import type { GroupRow, GroupsModel } from "@/services/user/groups-types";

/** Where a group opens: the Groups tab of its tenant with its panel. */
const groupHref = (group: GroupRow) => `/dashboard/users?tab=groups&open=${encodeURIComponent(group.id)}`;

interface TenantGroupsListProps {
    cards: boolean;
    /** The switch to the platform groups, before the search. */
    toolbarStart: React.ReactNode;
}

/**
 * The groups of every tenant on Users & Groups of the Platform, with a Tenant column and filter,
 * read only. A group belongs to its tenant and is changed there, so opening one switches into its
 * tenant and shows it on the Groups tab, like a row of All tenants.
 */
export function TenantGroupsList({ cards, toolbarStart }: TenantGroupsListProps) {
    const { model, isLoading, refresh } = usePageModel<GroupsModel>("/api/platform/groups", "The groups could not be loaded.");
    const openInTenant = useOpenInTenant();
    // A platform group of some tenants sees the groups of every tenant, and opens only its own.
    const mayOpen = useMayOpenTenant();
    const [opening, setOpening] = useState<string | null>(null);
    const groups = useMemo(() => model?.groups ?? [], [model]);
    const tenantIdOf = useCallback((group: GroupRow) => group.tenantId ?? null, []);
    const tenant = useTenantColumns(tenantIdOf, groups, { always: true });

    const open = useCallback(async (group: GroupRow) => {
        if (!group.tenantId || !mayOpen(group.tenantId)) return;
        setOpening(group.id);
        try {
            await openInTenant(group.tenantId, groupHref(group));
        } finally {
            setOpening(null);
        }
    }, [openInTenant, mayOpen]);

    const columns = useMemo(() => withTenantColumn(groupColumns({
        onOpen: (group) => void open(group),
        renderActions: (group) => mayOpen(group.tenantId) && (
            <Button
                variant="outline"
                size="sm"
                disabled={opening !== null}
                onClick={() => void open(group)}
                aria-label={`Open ${group.name} in ${tenant.nameOf(group.tenantId) ?? "its tenant"}`}
            >
                {opening === group.id ? <Loader2 className="animate-spin" /> : <ArrowRightLeft />}
                <span className="hidden sm:inline">Open in its tenant</span>
            </Button>
        ),
    }), tenant.column), [open, opening, tenant, mayOpen]);

    return (
        <div className="space-y-4 md:space-y-0">
            <GroupsStrip model={model} />
            {!model ? (
                <div className={cn("space-y-3 rounded-xl border bg-card p-4 shadow-sm", JOIN_END)} aria-busy="true">
                    <span className="sr-only">Loading the groups of every tenant</span>
                    <div className="flex gap-2">
                        <Skeleton className="h-8 w-60" />
                        <Skeleton className="h-8 w-24" />
                    </div>
                    {Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-14 w-full" />)}
                </div>
            ) : (
                <DataTable
                    joined
                    columns={columns}
                    data={groups}
                    searchKey="name"
                    searchPlaceholder="Search groups"
                    filterableColumns={tenant.filter ? [tenant.filter] : []}
                    toolbarStart={toolbarStart}
                    toolbarExtra={<span className="hidden text-xs text-muted-foreground lg:inline">Read only here, each is changed in its tenant</span>}
                    onRefresh={refresh}
                    isLoading={isLoading}
                    getRowId={(group) => group.id}
                    onRowClick={(group) => void open(group)}
                    view={cards ? "cards" : "table"}
                    renderCard={(row) => (
                        <GroupCard
                            group={row.original}
                            onOpen={(group) => void open(group)}
                            actions={<span className="truncate text-xs text-muted-foreground">{tenant.nameOf(row.original.tenantId)}</span>}
                        />
                    )}
                />
            )}
        </div>
    );
}
