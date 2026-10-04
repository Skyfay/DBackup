"use client";

import { useCallback, useImperativeHandle, useMemo, useState, type Ref } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { BackupContextMenu, BackupRowMenu } from "@/components/dashboard/storage/explorer/backup-menus";
import { ProviderTile } from "@/components/oidc/provider-logo";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { JOIN_END } from "@/components/ui/page-head";
import { Skeleton } from "@/components/ui/skeleton";
import { usePageModel } from "@/hooks/use-page-model";
import { useTableLayout } from "@/hooks/use-table-layout";
import type { TablePreferences } from "@/lib/core/table-preferences";
import { cn } from "@/lib/utils";
import type { SsoProviderRow, SsoProvidersModel } from "@/services/sso/sso-providers-types";
import { signInActions, type SignInActionHandlers } from "./sign-in-actions";
import { NAMED_ADAPTERS } from "./sign-in-adapters";
import { SignInCard } from "./sign-in-card";
import { onlyWayIn, placeLine } from "./sign-in-cells";
import { signInColumns } from "./sign-in-columns";
import { SignInDeleteDialog, SignInDisableDialog, toggleProvider } from "./sign-in-confirm-dialogs";
import { SignInDetails } from "./sign-in-details";
import { SignInFormDialog } from "./sign-in-form-dialog";
import type { SignInFormMode } from "./sign-in-form-values";
import { SignInFoot, SignInStrip } from "./sign-in-strip";
import { SIGN_IN_TABLE_ID } from "./sign-in-tables";

/** What the page around the list can start, like New provider beside the tabs. */
export interface SignInTabHandle {
    openCreate: () => void;
}

interface SignInTabProps {
    ref?: Ref<SignInTabHandle>;
    view: "table" | "cards";
    /** May add, change, switch and delete providers, which only a SuperAdmin does. */
    canManage: boolean;
    initialLayout: TablePreferences | null;
}

/**
 * The ways to sign in besides a password: the numbers, the providers as a table or as cards, a
 * panel with what a provider needs and who is linked through it, and the dialogs to add, change
 * and delete one. The client secret never reaches the browser. A phone gets cards.
 */
export function SignInTab({ ref, view, canManage, initialLayout }: SignInTabProps) {
    const router = useRouter();
    const { model, isLoading, refresh } = usePageModel<SsoProvidersModel>("/api/sso-providers", "The sign-in providers could not be loaded.");
    const layout = useTableLayout(SIGN_IN_TABLE_ID, initialLayout);
    // The id stays after closing, so the panel keeps its content while it slides out.
    const [details, setDetails] = useState<{ id: string; open: boolean } | null>(null);
    const [form, setForm] = useState<{ open: boolean; mode: SignInFormMode }>({ open: false, mode: { kind: "create" } });
    const [removing, setRemoving] = useState<SsoProviderRow | null>(null);
    const [disabling, setDisabling] = useState<SsoProviderRow | null>(null);

    const openCreate = useCallback(() => setForm({ open: true, mode: { kind: "create" } }), []);
    useImperativeHandle(ref, () => ({ openCreate }), [openCreate]);

    // The count beside the tab comes from the server, so the page loads again too.
    const afterChange = useCallback(() => {
        void refresh();
        router.refresh();
    }, [refresh, router]);

    const toggle = useCallback(async (provider: SsoProviderRow) => {
        // Switching off the only way in of someone asks first.
        if (provider.enabled && onlyWayIn(provider).length > 0) return setDisabling(provider);
        if (await toggleProvider(provider)) afterChange();
    }, [afterChange]);

    const handlers = useMemo<SignInActionHandlers>(() => canManage ? {
        onEdit: (provider) => setForm({ open: true, mode: { kind: "edit", provider } }),
        onToggle: (provider) => void toggle(provider),
        onDelete: setRemoving,
    } : {}, [canManage, toggle]);

    const open = useCallback((provider: SsoProviderRow) => setDetails({ id: provider.id, open: true }), []);
    const columns = useMemo(
        () => signInColumns({ onOpen: open, renderActions: (provider) => <BackupRowMenu name={provider.name} groups={signInActions(provider, handlers)} /> }),
        [open, handlers]
    );

    const providers = useMemo(() => model?.providers ?? [], [model]);
    const shown = details ? providers.find((provider) => provider.id === details.id) ?? null : null;

    return (
        <div className="space-y-4 md:space-y-0">
            <SignInStrip model={model} />

            {!model ? (
                <div className={cn("space-y-3 rounded-xl border bg-card p-4 shadow-sm", JOIN_END)} aria-busy="true">
                    <span className="sr-only">Loading sign-in providers</span>
                    <Skeleton className="h-8 w-60" />
                    {Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-12 w-full" />)}
                </div>
            ) : providers.length === 0 ? (
                <div className={cn("rounded-xl border bg-card px-4 py-12 text-center shadow-sm", JOIN_END)}>
                    <div className="mx-auto flex w-fit gap-2" aria-hidden="true">
                        {NAMED_ADAPTERS.map((adapterId) => <ProviderTile key={adapterId} adapterId={adapterId} />)}
                    </div>
                    <p className="mt-4 font-medium">No sign-in provider yet</p>
                    <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                        Add Authentik, Authelia, Keycloak, Pocket ID or any other OpenID Connect provider, and people sign in through it instead of a password.
                    </p>
                    {canManage && (
                        <Button tone="create" className="mt-4" onClick={openCreate}>
                            <Plus />
                            New provider
                        </Button>
                    )}
                </div>
            ) : (
                <DataTable
                    joined
                    columns={columns}
                    data={providers}
                    searchKey="name"
                    searchPlaceholder="Search by name, ID or host"
                    onRefresh={refresh}
                    isLoading={isLoading}
                    getRowId={(provider) => provider.id}
                    columnLayout={layout}
                    onRowClick={open}
                    activeRowId={details?.open ? details.id : null}
                    view={view}
                    renderCard={(row) => (
                        <SignInCard provider={row.original} onOpen={open} actions={<BackupRowMenu name={row.original.name} groups={signInActions(row.original, handlers)} />} />
                    )}
                    renderRowMenu={(provider, bulk) => (
                        <BackupContextMenu
                            tile={<ProviderTile adapterId={provider.adapterId} size="sm" />}
                            title={provider.name}
                            note={placeLine(provider)}
                            groups={signInActions(provider, handlers)}
                            bulk={bulk}
                        />
                    )}
                />
            )}

            {model && <SignInFoot model={model} canManage={canManage} />}

            {model && (
                <SignInDetails
                    open={details?.open ?? false}
                    provider={shown}
                    model={model}
                    onClose={() => setDetails((current) => current && { ...current, open: false })}
                    onEdit={handlers.onEdit}
                    menu={shown ? signInActions(shown, handlers, true) : []}
                    canManage={canManage}
                />
            )}

            {model && (
                <SignInFormDialog
                    open={form.open}
                    mode={form.mode}
                    model={model}
                    onOpenChange={(next) => setForm((current) => ({ ...current, open: next }))}
                    onSaved={afterChange}
                />
            )}

            {removing && (
                <SignInDeleteDialog
                    provider={removing}
                    onClose={() => setRemoving(null)}
                    onDeleted={() => {
                        setRemoving(null);
                        setDetails(null);
                        afterChange();
                    }}
                    onDisabled={() => {
                        setRemoving(null);
                        afterChange();
                    }}
                />
            )}
            {disabling && (
                <SignInDisableDialog
                    provider={disabling}
                    onClose={() => setDisabling(null)}
                    onDone={() => {
                        setDisabling(null);
                        afterChange();
                    }}
                />
            )}
        </div>
    );
}
