"use client";

import { useCallback, useImperativeHandle, useMemo, useState, type Ref } from "react";
import { useRouter } from "next/navigation";
import { Globe, Info, Trash } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { bulkDeleteTenantGroupTemplates } from "@/app/actions/auth/tenant-group-template";
import { GroupCard } from "@/components/dashboard/groups/group-card";
import { countWord, GroupTile } from "@/components/dashboard/groups/group-cells";
import { groupColumns, groupLine } from "@/components/dashboard/groups/group-columns";
import { GroupsStrip } from "@/components/dashboard/groups/group-strip";
import { BackupContextMenu, BackupRowMenu } from "@/components/dashboard/storage/explorer/backup-menus";
import { useTenantColumns } from "@/components/tenant/tenant-column";
import { withTenantColumn } from "@/components/tenant/tenant-rows";
import { useMayOpenTenant, useOpenInTenant, useTenantName } from "@/components/tenant/tenant-view";
import { DataTable, type BulkAction } from "@/components/ui/data-table";
import { JOIN_END } from "@/components/ui/page-head";
import { QuickFilter } from "@/components/ui/quick-filter";
import { Skeleton } from "@/components/ui/skeleton";
import { usePageModel } from "@/hooks/use-page-model";
import { platformGroupRefusal } from "@/lib/auth/platform-group-caps";
import { unwrapBulkAction } from "@/lib/bulk-request";
import { cn } from "@/lib/utils";
import type { GroupRow, GroupsModel, TenantGroupTemplateRow } from "@/services/user/groups-types";
import type { PlatformGroupsModel } from "@/services/user/platform-groups-types";
import { actorOf } from "./platform-group-form";
import { tenantGroupActions, type TenantGroupHandlers } from "./tenant-group-actions";
import { TenantGroupTemplateDeleteDialog } from "./tenant-group-template-delete-dialog";
import { TenantGroupTemplateDialog } from "./tenant-group-template-dialog";
import { adminRow, isBuiltInRow, isTemplateRow, reachLabel, templateIdOf, templateRow, templateShape } from "./tenant-group-template-model";

/** The id of the row of a group for tenants, which the bulk result names by the id of the group. */
const rowIdOf = (templateId: string) => `template:${templateId}`;

/** Where a group opens: the Groups tab of its tenant with its panel. */
const groupHref = (group: GroupRow) => `/dashboard/users?tab=groups&open=${encodeURIComponent(group.id)}`;

/** What the page around the list can start, New group for tenants beside the tabs. */
export interface TenantGroupsListHandle {
    openCreate: () => void;
}

type Quick = "all" | "templates" | "own";

interface TenantGroupsListProps {
    ref?: Ref<TenantGroupsListHandle>;
    cards: boolean;
    /** May make, change and delete groups for tenants. */
    canManage: boolean;
}

/**
 * The tenant groups on Users & Groups of the Platform: first the groups the platform makes for
 * tenants, each a real group in every tenant it reaches and changed here, then the own groups of
 * every tenant with a Tenant column and filter, read only. A group of a tenant is changed in its
 * tenant, so opening one switches into its tenant and shows it on the Groups tab. Groups for
 * tenants nobody holds can be deleted together.
 */
export function TenantGroupsList({ ref, cards, canManage }: TenantGroupsListProps) {
    const router = useRouter();
    const { model, isLoading, refresh } = usePageModel<GroupsModel>("/api/platform/groups", "The groups could not be loaded.");
    // The tenants and what the viewer may give, as the platform groups read them, for the editor.
    const { model: editor, refresh: refreshEditor } = usePageModel<PlatformGroupsModel>("/api/platform/platform-groups", "The tenants could not be loaded.");
    const openInTenant = useOpenInTenant();
    const nameOf = useTenantName();
    // A platform group of some tenants sees the groups of every tenant, and opens only its own.
    const mayOpen = useMayOpenTenant();
    const [quick, setQuick] = useState<Quick>("all");
    const [form, setForm] = useState<{ open: boolean; template: TenantGroupTemplateRow | null; copy: TenantGroupTemplateRow | null }>({ open: false, template: null, copy: null });
    const [removing, setRemoving] = useState<TenantGroupTemplateRow | null>(null);

    useImperativeHandle(ref, () => ({ openCreate: () => setForm({ open: true, template: null, copy: null }) }), []);

    const templates = useMemo(() => model?.templates ?? [], [model]);
    const byId = useMemo(() => new Map(templates.map((template) => [template.id, template])), [templates]);
    // The group of a tenant that a group for tenants is shows in the row of that one, and the
    // Admin of every tenant shows once as the built-in group for tenants.
    const own = useMemo(() => (model?.groups ?? []).filter((group) => !group.fromPlatform && !group.superAdmin), [model]);
    const builtIn = useMemo(() => adminRow(model?.groups ?? []), [model]);
    const forTenants = useMemo(() => [...(builtIn ? [builtIn] : []), ...templates.map(templateRow)], [builtIn, templates]);
    const rows = useMemo(() => [
        ...(quick === "own" ? [] : forTenants),
        ...(quick === "templates" ? [] : own),
    ], [forTenants, own, quick]);
    const tenantIdOf = useCallback((group: GroupRow) => group.tenantId ?? null, []);
    const tenant = useTenantColumns(tenantIdOf, own, { always: true });

    const afterChange = useCallback(() => {
        void refresh();
        void refreshEditor();
        router.refresh();
    }, [refresh, refreshEditor, router]);

    const templateOf = useCallback((group: GroupRow) => byId.get(templateIdOf(group)) ?? null, [byId]);
    const openTemplate = useCallback((group: GroupRow) => {
        const template = templateOf(group);
        if (template) setForm({ open: true, template, copy: null });
    }, [templateOf]);

    const open = useCallback(async (group: GroupRow) => {
        if (isBuiltInRow(group)) return;
        if (isTemplateRow(group)) return openTemplate(group);
        if (group.tenantId && mayOpen(group.tenantId)) await openInTenant(group.tenantId, groupHref(group));
    }, [openInTenant, mayOpen, openTemplate]);

    // Nobody changes or deletes a group for tenants that may do more than their own platform group gives.
    const actor = useMemo(() => (editor ? actorOf(editor.viewer) : null), [editor]);
    const editable = useCallback((group: GroupRow) => {
        const template = templateOf(group);
        return canManage && actor !== null && template !== null
            && platformGroupRefusal(actor, templateShape({ ...template, tenantIds: template.groups.map((entry) => entry.tenantId) })) === null;
    }, [canManage, actor, templateOf]);
    const handlers = useMemo<TenantGroupHandlers>(() => ({
        onOpen: openTemplate,
        onOpenInTenant: (group) => void open(group),
        ...(canManage ? {
            onDuplicate: (group: GroupRow) => setForm({ open: true, template: null, copy: templateOf(group) }),
            onDelete: (group: GroupRow) => setRemoving(templateOf(group)),
        } : {}),
    }), [canManage, open, openTemplate, templateOf]);
    const actionsOf = useCallback((group: GroupRow) => tenantGroupActions(
        group,
        isTemplateRow(group) || mayOpen(group.tenantId) ? handlers : { ...handlers, onOpenInTenant: undefined },
        editable(group),
    ), [handlers, mayOpen, editable]);

    // The Tenant column says where a group for tenants reaches, and its filter keeps it where it does.
    const tenantColumn = useMemo<ColumnDef<GroupRow> | null>(() => tenant.column && {
        ...tenant.column,
        filterFn: (row, id, value: string[]) => {
            if (isBuiltInRow(row.original)) return true;
            if (!isTemplateRow(row.original)) return tenant.column?.filterFn instanceof Function ? tenant.column.filterFn(row, id, value, () => undefined) : true;
            const template = byId.get(templateIdOf(row.original));
            return !value?.length || Boolean(template?.allTenants || template?.groups.some((group) => value.includes(group.tenantId)));
        },
        cell: (context) => {
            if (isBuiltInRow(context.row.original)) {
                return (
                    <div className="min-w-0 max-w-56">
                        <span className="flex items-center gap-1.5 text-sm font-medium"><Globe className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />All tenants</span>
                        <span className="block truncate text-xs text-muted-foreground">its own in each, new ones too</span>
                    </div>
                );
            }
            if (!isTemplateRow(context.row.original)) return typeof tenant.column?.cell === "function" ? tenant.column.cell(context) : null;
            const template = byId.get(templateIdOf(context.row.original));
            if (!template) return null;
            const names = template.groups.map((group) => nameOf(group.tenantId) ?? "A tenant").sort().join(", ");
            return (
                <div className="min-w-0 max-w-56">
                    <span className="flex items-center gap-1.5 text-sm font-medium">
                        {template.allTenants && <Globe className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
                        {reachLabel(template)}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground" title={names}>{template.allTenants ? "new ones too" : names || "none yet"}</span>
                </div>
            );
        },
    }, [tenant.column, byId, nameOf]);

    const columns = useMemo(() => withTenantColumn(groupColumns({
        onOpen: (group) => void open(group),
        markOf: (group) => (isTemplateRow(group) || isBuiltInRow(group) ? "For tenants" : null),
        renderActions: (group) => <BackupRowMenu name={group.name} groups={actionsOf(group)} />,
    }), tenantColumn), [open, actionsOf, tenantColumn]);

    const bulkActions = useMemo<BulkAction<GroupRow>[]>(() => canManage ? [{
        id: "delete",
        labels: { verb: "delete", verbPast: "deleted", noun: "group for tenants", nounPlural: "groups for tenants" },
        icon: Trash,
        variant: "destructive",
        itemName: (group) => group.name,
        itemDetail: (group) => reachLabel(templateOf(group) ?? { allTenants: false, groups: [] }),
        // Delete of one asks where its people go in each tenant, which a bulk delete cannot.
        ineligible: (group) => (group.members.length > 0 ? "People hold it, delete it on its own to decide where they go" : null),
        confirm: {
            title: (selected) => `Delete ${countWord(selected.length, "group", "groups")} for tenants?`,
            description: () => "Its group goes in every tenant it reaches. Nobody holds them, so nobody loses access.",
            confirmLabel: "Delete",
        },
        run: async (selected) => {
            const result = await unwrapBulkAction(bulkDeleteTenantGroupTemplates(selected.map(templateIdOf)));
            return { succeeded: result.succeeded.map(rowIdOf), failed: result.failed.map((failure) => ({ ...failure, id: rowIdOf(failure.id) })) };
        },
    }] : [], [canManage, templateOf]);

    const quickFilters = (
        <QuickFilter
            aria-label="Which groups"
            value={quick}
            onChange={setQuick}
            options={[
                { value: "all", label: "All", count: forTenants.length + own.length },
                { value: "templates", label: "For tenants", count: forTenants.length },
                { value: "own", label: "Own", count: own.length },
            ]}
        />
    );

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
                    data={rows}
                    searchKey="name"
                    searchPlaceholder="Search groups"
                    filterableColumns={tenant.filter ? [tenant.filter] : []}
                    toolbarExtra={quickFilters}
                    onRefresh={refresh}
                    isLoading={isLoading}
                    getRowId={(group) => group.id}
                    enableRowSelection={canManage && !cards}
                    isRowSelectable={(group) => isTemplateRow(group) && editable(group)}
                    bulkActions={bulkActions}
                    onBulkActionComplete={afterChange}
                    onRowClick={(group) => void open(group)}
                    activeRowId={form.open && form.template ? rowIdOf(form.template.id) : null}
                    view={cards ? "cards" : "table"}
                    renderCard={(row) => (
                        <GroupCard
                            group={row.original}
                            onOpen={(group) => void open(group)}
                            actions={
                                <span className="flex min-w-0 items-center gap-1">
                                    <span className="truncate text-xs text-muted-foreground">{isBuiltInRow(row.original) ? "All tenants" : isTemplateRow(row.original) ? reachLabel(templateOf(row.original) ?? { allTenants: false, groups: [] }) : tenant.nameOf(row.original.tenantId)}</span>
                                    <BackupRowMenu name={row.original.name} groups={actionsOf(row.original)} />
                                </span>
                            }
                        />
                    )}
                    renderRowMenu={(group, bulk) => (
                        <BackupContextMenu
                            tile={<GroupTile group={group} size="sm" />}
                            title={group.name}
                            note={isBuiltInRow(group) ? "Built in, every tenant has one" : isTemplateRow(group) ? `For tenants · ${countWord(group.members.length, "member", "members")}` : `${tenant.nameOf(group.tenantId) ?? "A tenant"} · ${groupLine(group)}`}
                            groups={actionsOf(group)}
                            bulk={bulk}
                        />
                    )}
                />
            )}
            <p className="flex items-center gap-2 text-xs text-muted-foreground md:mt-4">
                <Info className="size-3.5 shrink-0" aria-hidden="true" />
                A group for tenants is one group in every tenant it reaches. Their admins give it to people, only the platform changes or deletes it. Admin is built in, with every permission in each tenant. The own groups of a tenant change there.
            </p>

            {model && editor && (
                <TenantGroupTemplateDialog
                    open={form.open}
                    template={form.template}
                    copyOf={form.copy}
                    groups={model.groups}
                    editor={editor}
                    templates={templates}
                    taken={templates.filter((template) => template.id !== form.template?.id).map((template) => template.name)}
                    canManage={canManage}
                    onOpenChange={(next) => setForm((current) => ({ ...current, open: next }))}
                    onDelete={canManage ? (template) => {
                        setForm((current) => ({ ...current, open: false }));
                        setRemoving(template);
                    } : undefined}
                    onSaved={afterChange}
                />
            )}
            {removing && model && (
                <TenantGroupTemplateDeleteDialog
                    template={removing}
                    groups={model.groups}
                    onClose={() => setRemoving(null)}
                    onDeleted={() => {
                        setRemoving(null);
                        afterChange();
                    }}
                />
            )}
        </div>
    );
}
