"use client";

import { useCallback, useImperativeHandle, useMemo, useState, type Ref } from "react";
import { useRouter } from "next/navigation";
import { Trash } from "lucide-react";
import { BackupContextMenu, BackupRowMenu } from "@/components/dashboard/storage/explorer/backup-menus";
import { CredentialProfileDialog, type CredentialProfileSummary } from "@/components/settings/credential-profile-dialog";
import { CREDENTIAL_TYPE_INFO } from "@/components/settings/credential-types";
import { DataTable, type BulkAction } from "@/components/ui/data-table";
import { JOIN_END } from "@/components/ui/page-head";
import { QuickFilter } from "@/components/ui/quick-filter";
import { Skeleton } from "@/components/ui/skeleton";
import { useTableLayout } from "@/hooks/use-table-layout";
import { requestBulk } from "@/lib/bulk-request";
import type { TablePreferences } from "@/lib/core/table-preferences";
import { cn } from "@/lib/utils";
import type { VaultCredential, VaultCredentialsModel } from "@/services/vault/vault-types";
import { credentialActions, type CredentialActionHandlers } from "./credential-actions";
import { CredentialCard } from "./credential-card";
import { credentialColumns, credentialFilters } from "./credential-columns";
import { CredentialDetails } from "./credential-details";
import { CredentialDeleteDialog, PublicKeyDialog, RevealSecretDialog, revealSecret } from "./credential-dialogs";
import { useTrash } from "@/components/trash/use-trash";
import { TypeTile } from "./vault-cells";
import { credentialBlocker, matchesCredential, type CredentialQuick } from "./vault-format";
import { CredentialsStrip } from "./vault-strips";
import { useVaultModel } from "./use-vault-model";
import { VAULT_TABLE_IDS } from "./vault-tables";

/** What the page around the list can start, like New profile beside the tabs. */
export interface CredentialsTabHandle {
    openCreate: () => void;
}

export interface CredentialsAccess {
    canWrite: boolean;
    canDelete: boolean;
    canReveal: boolean;
}

interface CredentialsTabProps {
    ref?: Ref<CredentialsTabHandle>;
    cards: boolean;
    access: CredentialsAccess;
    initialLayout: TablePreferences | null;
}

/** What the profile dialog needs of a profile. It never gets the connections, which it lists differently. */
function summaryOf(profile: VaultCredential): CredentialProfileSummary {
    const { id, name, type, description, createdAt, updatedAt, secretStatus, publicKey, fingerprint } = profile;
    return { id, name, type, description, createdAt, updatedAt, secretStatus, publicKey, fingerprint };
}

const QUICK_OPTIONS: { value: CredentialQuick; label: string }[] = [
    { value: "all", label: "All" },
    { value: "used", label: "In use" },
    { value: "unused", label: "Unused" },
];

/**
 * The credential profiles of the Vault: the numbers, then the list with its filters, a panel with
 * the details of a profile, and every dialog of a profile. A phone gets cards.
 */
export function CredentialsTab({ ref, cards, access, initialLayout }: CredentialsTabProps) {
    const router = useRouter();
    const { model, isLoading, refresh } = useVaultModel<VaultCredentialsModel>("/api/vault/credentials");
    const layout = useTableLayout(VAULT_TABLE_IDS.credentials, initialLayout);
    const [quick, setQuick] = useState<CredentialQuick>("all");
    // The id stays after closing, so the panel keeps its content while it slides out.
    const [details, setDetails] = useState<{ id: string; open: boolean } | null>(null);
    const [form, setForm] = useState<{ open: boolean; profile: VaultCredential | null }>({ open: false, profile: null });
    const [revealing, setRevealing] = useState<{ profile: VaultCredential; payload: Record<string, unknown> | null } | null>(null);
    const [removing, setRemoving] = useState<VaultCredential | null>(null);
    const [publicKey, setPublicKey] = useState<VaultCredential | null>(null);

    useImperativeHandle(ref, () => ({ openCreate: () => setForm({ open: true, profile: null }) }), []);

    // The counts beside the tabs come from the server, so they are loaded again too.
    const afterChange = useCallback(() => {
        void refresh();
        router.refresh();
    }, [refresh, router]);

    // The dialog opens at once and fills in when the server answers. A refusal closes it again.
    const reveal = useCallback((profile: VaultCredential) => {
        setRevealing({ profile, payload: null });
        void revealSecret(profile).then((payload) =>
            setRevealing((current) => (current?.profile.id !== profile.id ? current : payload ? { profile, payload } : null))
        );
    }, []);

    const handlers = useMemo<CredentialActionHandlers>(() => ({
        onPublicKey: setPublicKey,
        onReveal: access.canReveal ? reveal : undefined,
        onEdit: access.canWrite ? (profile) => setForm({ open: true, profile }) : undefined,
        onDelete: access.canDelete ? setRemoving : undefined,
    }), [access, reveal]);

    const open = useCallback((profile: VaultCredential) => setDetails({ id: profile.id, open: true }), []);
    const columns = useMemo(
        () => credentialColumns({ onOpen: open, renderActions: (profile) => <BackupRowMenu name={profile.name} groups={credentialActions(profile, handlers)} /> }),
        [open, handlers]
    );

    const profiles = useMemo(() => model?.profiles ?? [], [model]);
    const rows = useMemo(() => profiles.filter((profile) => matchesCredential(profile, quick)), [profiles, quick]);
    const filters = useMemo(() => credentialFilters(profiles), [profiles]);
    const trash = useTrash("credential", afterChange);
    const bulkActions = useMemo<BulkAction<VaultCredential>[]>(() => access.canDelete ? [{
        id: "delete",
        labels: { verb: "delete", verbPast: "deleted", noun: "credential profile" },
        icon: Trash,
        variant: "destructive",
        itemName: (profile) => profile.name,
        itemIcon: (profile) => CREDENTIAL_TYPE_INFO[profile.type].icon,
        itemDetail: (profile) => CREDENTIAL_TYPE_INFO[profile.type].title,
        // Profiles that connections still log in with are listed apart and never sent.
        ineligible: credentialBlocker,
        confirm: {
            title: (selected) => `Delete ${selected.length} credential profile${selected.length === 1 ? "" : "s"}?`,
            confirmLabel: "Delete",
        },
        trash: {
            ...trash,
            permanentLine: (selected) => (selected.length === 1
                ? "For a login that leaked. It skips Recently deleted with the secret it holds."
                : "For logins that leaked. They skip Recently deleted with the secrets they hold."),
        },
        run: (selected, { permanently }) =>
            requestBulk("/api/credentials/bulk", { action: "delete", ids: selected.map((profile) => profile.id), ...(permanently ? { permanently } : {}) }),
    }] : [], [access.canDelete, trash]);

    const shown = details ? profiles.find((profile) => profile.id === details.id) ?? null : null;

    return (
        <div className="space-y-4 md:space-y-0">
            <CredentialsStrip model={model} />

            {!model ? (
                <div className={cn("space-y-3 rounded-xl border bg-card p-4 shadow-sm", JOIN_END)} aria-busy="true">
                    <span className="sr-only">Loading credential profiles</span>
                    <div className="flex gap-2">
                        <Skeleton className="h-8 w-60" />
                        <Skeleton className="h-8 w-24" />
                    </div>
                    {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-11 w-full" />)}
                </div>
            ) : (
                <DataTable
                    variant="card"
                    joined
                    columns={columns}
                    data={rows}
                    searchKey="name"
                    searchPlaceholder="Search profiles"
                    filterableColumns={filters}
                    toolbarExtra={
                        <QuickFilter
                            aria-label="Filter by use"
                            value={quick}
                            onChange={setQuick}
                            options={QUICK_OPTIONS.map((option) => ({ ...option, count: profiles.filter((profile) => matchesCredential(profile, option.value)).length }))}
                        />
                    }
                    onRefresh={refresh}
                    isLoading={isLoading}
                    enableRowSelection={access.canDelete && !cards}
                    getRowId={(profile) => profile.id}
                    bulkActions={bulkActions}
                    onBulkActionComplete={afterChange}
                    columnLayout={layout}
                    onRowClick={open}
                    view={cards ? "cards" : "table"}
                    renderCard={(row) => (
                        <CredentialCard
                            profile={row.original}
                            onOpen={open}
                            actions={<BackupRowMenu name={row.original.name} groups={credentialActions(row.original, handlers)} />}
                        />
                    )}
                    renderRowMenu={(profile, bulk) => (
                        <BackupContextMenu
                            tile={<TypeTile type={profile.type} />}
                            title={profile.name}
                            note={CREDENTIAL_TYPE_INFO[profile.type].title}
                            groups={credentialActions(profile, handlers)}
                            bulk={bulk}
                        />
                    )}
                />
            )}

            <CredentialDetails
                open={details?.open ?? false}
                profile={shown}
                auditDays={model?.auditDays ?? 90}
                onClose={() => setDetails((current) => current && { ...current, open: false })}
                onEdit={handlers.onEdit}
                onReveal={handlers.onReveal}
                groups={shown ? credentialActions(shown, handlers, true) : []}
            />

            <CredentialProfileDialog
                open={form.open}
                onOpenChange={(next) => setForm((current) => ({ ...current, open: next }))}
                editProfile={form.profile ? summaryOf(form.profile) : null}
                onSaved={afterChange}
            />

            {revealing && <RevealSecretDialog profile={revealing.profile} payload={revealing.payload} onClose={() => setRevealing(null)} />}
            {publicKey && <PublicKeyDialog profile={publicKey} onClose={() => setPublicKey(null)} />}
            {removing && (
                <CredentialDeleteDialog
                    profile={removing}
                    onClose={() => setRemoving(null)}
                    onDeleted={() => {
                        setRemoving(null);
                        setDetails(null);
                        afterChange();
                    }}
                    onRestored={afterChange}
                />
            )}
        </div>
    );
}
