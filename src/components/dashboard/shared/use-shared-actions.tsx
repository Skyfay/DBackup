"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Download, Play, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { downloadSharedBackup, restoreSharedDatabase } from "@/app/actions/tenant/shared-databases";
import { runHref } from "@/components/dashboard/history/run-links";
import type { BackupActionGroup } from "@/components/dashboard/storage/explorer/backup-actions";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import type { SharedDatabase } from "@/services/tenant/shared-databases";
import { backupRef, formerLabel, isFormer, onDemandLine, restoreStarted, type SharedRow } from "./shared-model";
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

/** The line at the foot of the menu of a shared backup: what stays with the provider, or why it only downloads. */
export function sharedMenuFoot(row: SharedRow): React.ReactNode {
    const { database } = row;
    const text = database.serverGone
        ? `${formerLabel(database)}. ${database.providerName} keeps the archive, its dumps still download.`
        : isFormer(database)
            ? `${database.databaseName} is no longer yours, its dumps from your time still download.`
            : `${database.providerName} keeps the archive. Verify, lock and delete stay with them.`;
    return (
        <span className="flex items-start gap-2">
            <Building2 className="mt-px size-3.5 shrink-0" aria-hidden="true" />
            <span>{text}</span>
        </span>
    );
}

/**
 * Download and Restore of a shared backup, and Back up now of its database where its provider allows
 * it. Download hands out the dump of the one database, Restore asks first in a dialog and writes it
 * back into the same database, at its place of now when it moved. A database that is no longer the
 * tenant's, or whose server was deleted, only downloads.
 */
export function useSharedActions({ canDownload, canRestore, canViewHistory, canBackUp, databases, onChanged }: SharedAccess & { databases: SharedDatabase[]; onChanged: () => void }) {
    const router = useRouter();
    const openRun = useMemo(() => (canViewHistory ? (executionId: string) => router.push(runHref(executionId, "shared")) : undefined), [canViewHistory, router]);
    const backups = useBackUpNow({ databases, canBackUp, onChanged, openRun });
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
                // A restore refused before it started has a failed run that says why.
                const refusedRun = "executionId" in result ? result.executionId : undefined;
                toast.error(result.error, refusedRun && canViewHistory ? { action: { label: "Open the run", onClick: () => router.push(runHref(refusedRun, "shared")) } } : undefined);
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

    // A shared backup offers what the tenant may do with its database alone. Verify, lock and
    // delete stay with the provider, whose archive it is.
    const groupsFor = useCallback((row: SharedRow): BackupActionGroup[] => {
        const { database } = row;
        const name = database.databaseName;
        return [
            ...(restorable(row)
                ? [{
                    label: "Restore",
                    actions: [{ id: "restore", label: `Restore into ${name}`, note: `on ${database.serverName}, nothing else changes`, icon: RotateCcw, onSelect: () => setRestoring(row), tone: "warning" as const }],
                }]
                : []),
            ...(canDownload
                ? [{
                    label: "Download",
                    actions: [{ id: "download", label: "Download the dump", note: `${row.databaseName} alone, unpacked`, icon: Download, onSelect: () => void download(row), disabled: downloading !== null, tone: "neutral" as const }],
                }]
                : []),
            ...(backups.offered(database) && database.onDemand
                ? [{
                    label: "Back up",
                    actions: [{ id: "back-up", label: `Back up ${name} now`, note: onDemandLine(database.onDemand), icon: Play, onSelect: () => void backups.backUp(database), disabled: !backups.ready(database), tone: "neutral" as const }],
                }]
                : []),
        ];
    }, [restorable, backups, canDownload, download, downloading]);

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
        footFor: sharedMenuFoot,
        download: canDownload ? download : undefined,
        askRestore: (row: SharedRow) => (restorable(row) ? () => setRestoring(row) : undefined),
        downloading,
        dialogs,
        backups,
    };
}
