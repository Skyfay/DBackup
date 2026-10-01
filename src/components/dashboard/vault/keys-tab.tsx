"use client";

import { useCallback, useImperativeHandle, useMemo, useState, type Ref } from "react";
import { useRouter } from "next/navigation";
import { Download, Trash } from "lucide-react";
import { bulkDeleteEncryptionProfiles } from "@/app/actions/backup/encryption";
import { BackupContextMenu, BackupRowMenu } from "@/components/dashboard/storage/explorer/backup-menus";
import { EncryptionKeyDialog } from "@/components/settings/encryption-key-dialog";
import { DataTable, type BulkAction } from "@/components/ui/data-table";
import { JOIN_END } from "@/components/ui/page-head";
import { QuickFilter } from "@/components/ui/quick-filter";
import { Skeleton } from "@/components/ui/skeleton";
import { useTableLayout } from "@/hooks/use-table-layout";
import { unwrapBulkAction } from "@/lib/bulk-request";
import type { TablePreferences } from "@/lib/core/table-preferences";
import { cn } from "@/lib/utils";
import { isKeyInUse, type VaultKey, type VaultKeysModel } from "@/services/vault/vault-types";
import { EditKeyDialog } from "./edit-key-dialog";
import { ImportKeyDialog } from "./import-key-dialog";
import { keyActions, type KeyActionHandlers } from "./key-actions";
import { KeyCard } from "./key-card";
import { keyColumns } from "./key-columns";
import { KeyDeleteDialog } from "./key-delete-dialog";
import { useTrash } from "@/components/trash/use-trash";
import { KeyDetails } from "./key-details";
import { KeyRevealDialog, revealKey } from "./key-reveal-dialog";
import { RecoveryKitDialog } from "./recovery-kit-dialog";
import { MissingKeyBanner } from "./missing-key-banner";
import { KeyTile } from "./vault-cells";
import { count, keyBlocker, keyUse, type KeyQuick } from "./vault-format";
import { KeysStrip } from "./vault-strips";
import { useVaultModel } from "./use-vault-model";
import { VAULT_TABLE_IDS } from "./vault-tables";
import { useOpenFromLink } from "@/hooks/use-open-from-link";

/** What the page around the list can start, the buttons beside the tabs. */
export interface KeysTabHandle {
    openCreate: () => void;
    openImport: () => void;
    openKit: () => void;
}

interface KeysTabProps {
    ref?: Ref<KeysTabHandle>;
    cards: boolean;
    /** Everything but looking needs the right to write to the Vault, a kit and a reveal too. */
    canManage: boolean;
    initialLayout: TablePreferences | null;
}

const QUICK: Record<KeyQuick, (key: VaultKey) => boolean> = {
    all: () => true,
    used: isKeyInUse,
    kitless: (key) => key.kit === null,
};

/**
 * The encryption keys of the Vault: the numbers, backups whose key is missing, the list with a
 * panel for the details of a key, and every dialog of a key. A phone gets cards.
 */
export function KeysTab({ ref, cards, canManage, initialLayout }: KeysTabProps) {
    const router = useRouter();
    const { model, isLoading, refresh } = useVaultModel<VaultKeysModel>("/api/vault/keys");
    const layout = useTableLayout(VAULT_TABLE_IDS.keys, initialLayout);
    const [quick, setQuick] = useState<KeyQuick>("all");
    // The id stays after closing, so the panel keeps its content while it slides out.
    const [details, setDetails] = useState<{ id: string; open: boolean } | null>(null);
    const [creating, setCreating] = useState(false);
    const [importing, setImporting] = useState(false);
    const [kit, setKit] = useState<{ picked?: string[] } | null>(null);
    const [editing, setEditing] = useState<VaultKey | null>(null);
    const [removing, setRemoving] = useState<VaultKey | null>(null);
    const [revealing, setRevealing] = useState<{ key: VaultKey; value: string | null } | null>(null);

    useImperativeHandle(ref, () => ({
        openCreate: () => setCreating(true),
        openImport: () => setImporting(true),
        openKit: () => setKit({}),
    }), []);

    // The counts beside the tabs come from the server, so they are loaded again too.
    const afterChange = useCallback(() => {
        void refresh();
        router.refresh();
    }, [refresh, router]);

    // The dialog opens at once and fills in when the server answers. A refusal closes it again.
    const reveal = useCallback((key: VaultKey) => {
        setRevealing({ key, value: null });
        void revealKey(key).then((value) =>
            setRevealing((current) => (current?.key.id !== key.id ? current : value ? { key, value } : null))
        );
    }, []);

    const handlers = useMemo<KeyActionHandlers>(() => canManage ? {
        onKit: (key) => setKit({ picked: [key.id] }),
        onReveal: reveal,
        onEdit: setEditing,
        onDelete: setRemoving,
    } : {}, [canManage, reveal]);

    const open = useCallback((key: VaultKey) => setDetails({ id: key.id, open: true }), []);
    // A link like the search in the header opens one with `?open=`.
    useOpenFromLink(model?.keys, open);
    const columns = useMemo(
        () => keyColumns({ onOpen: open, renderActions: (key) => <BackupRowMenu name={key.name} groups={keyActions(key, handlers)} /> }),
        [open, handlers]
    );

    const keys = useMemo(() => model?.keys ?? [], [model]);
    const rows = useMemo(() => keys.filter(QUICK[quick]), [keys, quick]);
    const names = useMemo(() => keys.map((key) => key.name), [keys]);

    const trash = useTrash("encryptionKey", afterChange);
    const bulkActions = useMemo<BulkAction<VaultKey>[]>(() => canManage ? [
        {
            id: "kit",
            labels: { verb: "download", verbPast: "put into a recovery kit", noun: "key" },
            label: () => "Recovery kit",
            icon: Download,
            variant: "outline",
            dialog: ({ rows: selected, onClose, onDone }) => (
                <RecoveryKitDialog
                    keys={keys}
                    picked={selected.map((key) => key.id)}
                    onClose={onClose}
                    onDownloaded={(ids) => onDone({ succeeded: ids, failed: [] })}
                />
            ),
        },
        {
            id: "delete",
            labels: { verb: "delete", verbPast: "deleted", noun: "key" },
            icon: Trash,
            variant: "destructive",
            itemName: (key) => key.name,
            itemDetail: keyUse,
            // Keys a job or the config backup encrypts with are listed apart and never sent.
            ineligible: keyBlocker,
            confirm: {
                title: (selected) => `Delete ${count(selected.length, "key")}?`,
                description: () => "Backups made with these keys cannot be opened while the keys are gone.",
                confirmLabel: "Delete",
            },
            trash: {
                ...trash,
                permanentLine: (selected) => (selected.length === 1
                    ? "For a key that leaked. It skips Recently deleted, and without a recovery kit the backups made with it can never be opened again, by DBackup neither."
                    : "For keys that leaked. They skip Recently deleted, and without a recovery kit the backups made with them can never be opened again, by DBackup neither."),
            },
            run: (selected, { permanently }) => unwrapBulkAction(bulkDeleteEncryptionProfiles(selected.map((key) => key.id), { permanently })),
        },
    ] : [], [canManage, keys, trash]);

    const shown = details ? keys.find((key) => key.id === details.id) ?? null : null;

    return (
        <div className="flex flex-col gap-4 md:gap-0">
            <KeysStrip model={model} />
            {/* From md up the numbers and the list join the tabs above them into one card, so the banner moves under it. */}
            {model && <MissingKeyBanner model={model} onImport={canManage ? () => setImporting(true) : undefined} className="md:order-last md:mt-6" />}

            {!model ? (
                <div className={cn("space-y-3 rounded-xl border bg-card p-4 shadow-sm", JOIN_END)} aria-busy="true">
                    <span className="sr-only">Loading encryption keys</span>
                    <div className="flex gap-2">
                        <Skeleton className="h-8 w-60" />
                        <Skeleton className="h-8 w-24" />
                    </div>
                    {Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-12 w-full" />)}
                </div>
            ) : (
                <DataTable
                    variant="card"
                    joined
                    columns={columns}
                    data={rows}
                    searchKey="name"
                    searchPlaceholder="Search keys"
                    toolbarExtra={
                        <QuickFilter
                            aria-label="Filter the keys"
                            value={quick}
                            onChange={setQuick}
                            options={[
                                { value: "all", label: "All", count: keys.length },
                                { value: "used", label: "In use", count: keys.filter(QUICK.used).length },
                                { value: "kitless", label: "Never in a kit", dot: "bg-warning", count: keys.filter(QUICK.kitless).length },
                            ]}
                        />
                    }
                    onRefresh={refresh}
                    isLoading={isLoading}
                    enableRowSelection={canManage && !cards}
                    getRowId={(key) => key.id}
                    bulkActions={bulkActions}
                    onBulkActionComplete={afterChange}
                    columnLayout={layout}
                    onRowClick={open}
                    view={cards ? "cards" : "table"}
                    renderCard={(row) => (
                        <KeyCard
                            keyRow={row.original}
                            onOpen={open}
                            onKit={handlers.onKit}
                            onReveal={handlers.onReveal}
                            actions={<BackupRowMenu name={row.original.name} groups={keyActions(row.original, handlers)} />}
                        />
                    )}
                    renderRowMenu={(key, bulk) => (
                        <BackupContextMenu tile={<KeyTile />} title={key.name} note={keyUse(key)} groups={keyActions(key, handlers)} bulk={bulk} />
                    )}
                />
            )}

            <KeyDetails
                open={details?.open ?? false}
                keyRow={shown}
                auditDays={model?.auditDays ?? 90}
                onClose={() => setDetails((current) => current && { ...current, open: false })}
                onKit={handlers.onKit}
                onReveal={handlers.onReveal}
                onEdit={handlers.onEdit}
                groups={shown ? keyActions(shown, handlers, true) : []}
            />

            <EncryptionKeyDialog
                open={creating}
                onOpenChange={setCreating}
                taken={names}
                onCreated={afterChange}
                withKit
                onKitDownloaded={() => void refresh()}
            />
            {importing && (
                <ImportKeyDialog
                    taken={names}
                    onClose={() => setImporting(false)}
                    onImported={() => {
                        setImporting(false);
                        afterChange();
                    }}
                />
            )}
            {kit && (
                <RecoveryKitDialog
                    keys={keys}
                    picked={kit.picked}
                    onClose={() => setKit(null)}
                    onDownloaded={() => {
                        setKit(null);
                        void refresh();
                    }}
                />
            )}
            {editing && (
                <EditKeyDialog
                    keyRow={editing}
                    taken={names.filter((name) => name !== editing.name)}
                    onClose={() => setEditing(null)}
                    onSaved={() => {
                        setEditing(null);
                        afterChange();
                    }}
                />
            )}
            {revealing && (
                <KeyRevealDialog
                    keyRow={revealing.key}
                    value={revealing.value}
                    onClose={() => setRevealing(null)}
                    onKit={handlers.onKit ? (key) => {
                        setRevealing(null);
                        setKit({ picked: [key.id] });
                    } : undefined}
                />
            )}
            {removing && (
                <KeyDeleteDialog
                    keyRow={removing}
                    canKit={canManage}
                    onKitDownloaded={() => void refresh()}
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
