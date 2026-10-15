"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Play, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { downloadSharedBackup, restoreSharedDatabase } from "@/app/actions/tenant/shared-databases";
import { runHref } from "@/components/dashboard/history/run-links";
import type { BackupActionGroup } from "@/components/dashboard/storage/explorer/backup-actions";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import type { SharedDatabase } from "@/services/tenant/shared-databases";
import { backupRef, isFormer, restoreStarted, type SharedRow } from "./shared-model";
import { SharedRestoreDialog } from "./shared-restore-dialog";
import { useBackUpNow } from "./use-back-up-now";

const log = logger.child({ component: "shared-actions" });

export interface SharedAccess {
    canDownload: boolean;
    canRestore: boolean;
    /** Whether the run of a restore may be opened, which lives in History. */
    canViewHistory: boolean;
    /** Whether the viewer may start a backup its provider allows, which Run now of a job allows. */
    canBackUp: boolean;
}

/**
 * Download and Restore of a shared backup, and Back up now of its database where its provider allows
 * it. Download hands out the dump of the one database, Restore asks first in a dialog and writes it
 * back into the same database, at its place of now when it moved. A database that is no longer the
 * tenant's, or whose server was deleted, only downloads.
 */
export function useSharedActions({ canDownload, canRestore, canViewHistory, canBackUp, databases, onChanged }: SharedAccess & { databases: SharedDatabase[]; onChanged: () => void }) {
    const router = useRouter();
    const backups = useBackUpNow({ databases, canBackUp, onChanged });
    const [downloading, setDownloading] = useState<string | null>(null);
    const [restoring, setRestoring] = useState<SharedRow | null>(null);
    const [pending, setPending] = useState(false);

    const download = useCallback(async (row: SharedRow) => {
        setDownloading(row.id);
        try {
            const result = await downloadSharedBackup(backupRef(row));
            if (!result.success) {
                toast.error(result.error);
                return;
            }
            toast.success(`The download of ${result.data.fileName} starts`);
            window.location.assign(result.data.url);
        } catch (error: unknown) {
            log.warn("Preparing a shared download failed", { sourceId: row.sourceId }, wrapError(error));
            toast.error("The backup could not be downloaded.");
        } finally {
            setDownloading(null);
        }
    }, []);

    const restore = async () => {
        if (!restoring) return;
        setPending(true);
        try {
            const result = await restoreSharedDatabase(backupRef(restoring));
            if (!result.success) {
                toast.error(result.error);
                return;
            }
            const executionId = result.data.executionId;
            toast.success(restoreStarted(restoring), {
                description: "It runs in the background.",
                ...(canViewHistory ? { action: { label: "Open the run", onClick: () => router.push(runHref(executionId, "shared")) } } : {}),
            });
            setRestoring(null);
        } catch (error: unknown) {
            log.warn("Starting a shared restore failed", { sourceId: restoring.sourceId }, wrapError(error));
            toast.error("The restore could not be started.");
        } finally {
            setPending(false);
        }
    };

    const restorable = useCallback((row: SharedRow) => canRestore && !isFormer(row.database), [canRestore]);

    const groupsFor = useCallback((row: SharedRow): BackupActionGroup[] => [
        ...(restorable(row)
            ? [{ label: "Restore", actions: [{ id: "restore", label: `Restore ${row.database.databaseName}`, icon: RotateCcw, onSelect: () => setRestoring(row), tone: "warning" as const }] }]
            : []),
        ...(backups.offered(row.database)
            ? [{ label: "Back up", actions: [{ id: "back-up", label: `Back up ${row.database.databaseName} now`, icon: Play, onSelect: () => void backups.backUp(row.database), disabled: !backups.ready(row.database), tone: "neutral" as const }] }]
            : []),
        ...(canDownload
            ? [{ label: "Download", actions: [{ id: "download", label: "Download the dump", icon: Download, onSelect: () => void download(row), disabled: downloading !== null, tone: "neutral" as const }] }]
            : []),
    ], [restorable, backups, canDownload, download, downloading]);

    const dialogs = restoring ? (
        <SharedRestoreDialog
            row={restoring}
            databases={databases}
            pending={pending}
            onClose={() => !pending && setRestoring(null)}
            onConfirm={() => void restore()}
        />
    ) : null;

    return {
        groupsFor,
        download: canDownload ? download : undefined,
        askRestore: (row: SharedRow) => (restorable(row) ? () => setRestoring(row) : undefined),
        downloading,
        dialogs,
        backups,
    };
}
