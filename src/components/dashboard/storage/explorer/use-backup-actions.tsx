"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { lockBackup } from "@/app/actions/storage/lock";
import { EncryptionKeyResolutionDialog, type KeyResolutionResult } from "@/components/common/encryption-key-resolution-dialog";
import { DownloadDialog } from "@/components/dashboard/storage/download/download-dialog";
import { IntegrityModal } from "@/components/dashboard/storage/integrity-modal";
import type { RestoreMode } from "@/components/dashboard/storage/restore-scope";
import { ConfirmDialog, DialogItemList } from "@/components/ui/confirm-dialog";
import { keyOverrideBody, useEncryptionKeyRecovery } from "@/hooks/use-encryption-key-recovery";
import { requestBulk } from "@/lib/bulk-request";
import { emptyBulkResult, summarizeBulkResult, type BulkResult } from "@/lib/core/bulk";
import { encodeUrlPayload } from "@/lib/url-payload";
import type { ExplorerDestination, ExplorerFile } from "@/services/storage/explorer-types";
import type { BackupActionHandlers } from "./backup-actions";

/** One copy of a backup: the file and the destination it lies at. */
export interface BackupTarget {
    file: ExplorerFile;
    destinationId: string;
}

interface Options {
    canDownload: boolean;
    canRestore: boolean;
    canDelete: boolean;
    canManageVault: boolean;
    destinations: Map<string, ExplorerDestination>;
    /** Reloads what the page shows after something changed. */
    onChanged: () => void;
}

const DELETE_LABELS = { verb: "delete", verbPast: "deleted", noun: "backup" };

/**
 * Runs one bulk action of the storage API for copies at several destinations, one request per
 * destination, and reports every copy by `destination:path`.
 */
export async function bulkAcross(action: "delete" | "lock" | "unlock", targets: BackupTarget[]): Promise<BulkResult> {
    const byDestination = new Map<string, string[]>();
    for (const target of targets) {
        const paths = byDestination.get(target.destinationId) ?? [];
        paths.push(target.file.path);
        byDestination.set(target.destinationId, paths);
    }
    const merged = emptyBulkResult();
    for (const [destinationId, paths] of byDestination) {
        const result = await requestBulk(`/api/storage/${destinationId}/files/bulk`, { action, paths });
        merged.succeeded.push(...result.succeeded.map((path) => `${destinationId}:${path}`));
        merged.failed.push(...result.failed.map((failure) => ({ ...failure, id: `${destinationId}:${failure.id}` })));
    }
    return merged;
}

/**
 * Everything the explorer does with a backup, and the dialogs it needs for that. Both the list by
 * job and the list by destination use it, so a copy is always handled the same way whichever list
 * it was opened from.
 */
export function useBackupActions({ canDownload, canRestore, canDelete, canManageVault, destinations, onChanged }: Options) {
    const router = useRouter();
    const keyRecovery = useEncryptionKeyRecovery();
    /** Which backup the key dialog is about, so a typed key can be checked against it. */
    const [pendingKey, setPendingKey] = useState<BackupTarget | null>(null);
    const [downloading, setDownloading] = useState<BackupTarget | null>(null);
    const [verify, setVerify] = useState<BackupTarget | null>(null);
    const [deleting, setDeleting] = useState<{ targets: BackupTarget[]; title: string } | null>(null);
    const [deletePending, setDeletePending] = useState(false);

    const restore = useCallback((target: BackupTarget, mode?: RestoreMode) => {
        const encoded = encodeUrlPayload(target.file);
        // Only a backup holding databases and folders gets a scope, everything else has one thing to restore.
        const modeParam = mode && mode !== "all" ? `&mode=${mode}` : "";
        router.push(`/dashboard/storage/restore?destinationId=${encodeURIComponent(target.destinationId)}&file=${encodeURIComponent(encoded)}${modeParam}`);
    }, [router]);

    const downloadDecrypted = useCallback(async (target: BackupTarget, keyResolution: KeyResolutionResult | null) => {
        const baseUrl = `/api/storage/${target.destinationId}/download`;
        try {
            // Decrypted on the server first. The call returns a token, never the backup, so the key
            // dialog can still step in while the transfer stays a plain browser download.
            const response = await fetch(baseUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ file: target.file.path, prepare: true, ...keyOverrideBody(keyResolution) }),
            });
            if (await keyRecovery.intercept(response, (result) => downloadDecrypted(target, result))) {
                setPendingKey(target);
                return;
            }
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || !payload?.data?.token) {
                toast.error(payload?.error ?? "Download failed");
                return;
            }
            const anchor = document.createElement("a");
            anchor.href = `${baseUrl}?token=${encodeURIComponent(payload.data.token)}`;
            anchor.click();
        } catch {
            toast.error("Download failed");
        }
    }, [keyRecovery]);

    const download = useCallback((target: BackupTarget, decrypt: boolean) => {
        if (!decrypt) {
            window.open(`/api/storage/${target.destinationId}/download?file=${encodeURIComponent(target.file.path)}`, "_blank");
            return;
        }
        void downloadDecrypted(target, null);
    }, [downloadDecrypted]);

    const toggleLock = useCallback(async (target: BackupTarget) => {
        try {
            const result = await lockBackup(target.destinationId, target.file.path);
            if (!result.success) {
                toast.error(result.error || "The lock could not be changed");
                return;
            }
            toast.success(result.locked ? "Backup locked, retention leaves it alone" : "Backup unlocked");
            onChanged();
        } catch {
            toast.error("The lock could not be changed");
        }
    }, [onChanged]);

    /** Asks before deleting copies, one or many, at one destination or several. */
    const askDelete = useCallback((targets: BackupTarget[], title?: string) => {
        if (targets.length === 0) return;
        setDeleting({ targets, title: title ?? (targets.length === 1 ? "Delete this backup?" : `Delete ${targets.length} backups?`) });
    }, []);

    const confirmDelete = async () => {
        if (!deleting) return;
        setDeletePending(true);
        try {
            const result = await bulkAcross("delete", deleting.targets);
            const failure = result.failed[0];
            if (failure) toast.error(result.succeeded.length > 0 ? `${summarizeBulkResult(result, DELETE_LABELS)}. ${failure.error}` : failure.error);
            else toast.success(summarizeBulkResult(result, DELETE_LABELS));
            setDeleting(null);
            onChanged();
        } catch (error: unknown) {
            toast.error(error instanceof Error ? error.message : "The backups could not be deleted");
        } finally {
            setDeletePending(false);
        }
    };

    /** The handlers of one copy, for its menu and its details. Actions the user may not take are left out. */
    const handlersFor = useCallback((target: BackupTarget): BackupActionHandlers => ({
        onRestore: canRestore ? (mode) => restore(target, mode) : undefined,
        onDownload: canDownload ? () => setDownloading(target) : undefined,
        onVerify: () => setVerify(target),
        onToggleLock: canDelete ? () => void toggleLock(target) : undefined,
        onDelete: canDelete ? () => askDelete([target]) : undefined,
    }), [canRestore, canDownload, canDelete, restore, toggleLock, askDelete]);

    const deleteCount = deleting?.targets.length ?? 0;
    const dialogs = (
        <>
            <ConfirmDialog
                open={deleting !== null}
                onOpenChange={(open) => !open && setDeleting(null)}
                title={deleting?.title ?? ""}
                note="Cannot be undone"
                description="This removes the archives and their metadata from the storage."
                icon={Trash2}
                destructive
                confirmLabel={deleteCount === 1 ? "Delete backup" : `Delete ${deleteCount} backups`}
                isPending={deletePending}
                onConfirm={() => void confirmDelete()}
            >
                <DialogItemList
                    size={deleteCount > 4 ? "small" : "default"}
                    items={(deleting?.targets ?? []).slice(0, 50).map((target) => ({
                        id: `${target.destinationId}:${target.file.path}`,
                        name: target.file.name,
                        detail: destinations.get(target.destinationId)?.name ?? "",
                    }))}
                />
            </ConfirmDialog>

            {downloading && (
                <DownloadDialog
                    open
                    onOpenChange={(open) => !open && setDownloading(null)}
                    destinationId={downloading.destinationId}
                    file={downloading.file}
                    keyOverride={keyRecovery.override}
                    interceptKeyRequest={async (res, retry) => {
                        const tookOver = await keyRecovery.intercept(res, retry);
                        if (tookOver) setPendingKey(downloading);
                        return tookOver;
                    }}
                    onStored={() => download(downloading, false)}
                    onDecrypted={() => download(downloading, true)}
                    onSingleFiles={canRestore ? () => {
                        setDownloading(null);
                        restore(downloading, "files");
                    } : undefined}
                />
            )}

            {verify && (
                <IntegrityModal
                    open
                    onOpenChange={(open) => !open && setVerify(null)}
                    file={verify.file}
                    storageConfigId={verify.destinationId}
                    onVerifyComplete={onChanged}
                />
            )}

            <EncryptionKeyResolutionDialog
                open={keyRecovery.open}
                onOpenChange={(open) => {
                    keyRecovery.onOpenChange(open);
                    if (!open) setPendingKey(null);
                }}
                profileIdHint={keyRecovery.profileIdHint}
                backup={pendingKey ? { storageConfigId: pendingKey.destinationId, file: pendingKey.file.path } : undefined}
                canManageVault={canManageVault}
                onConfirm={keyRecovery.onConfirm}
                loading={keyRecovery.loading}
                error={keyRecovery.error}
            />
        </>
    );

    return { handlersFor, askDelete, restore, dialogs };
}
