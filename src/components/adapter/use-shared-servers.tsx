"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { downloadSharedBackup, restoreSharedDatabase } from "@/app/actions/tenant/shared-databases";
import { runHref } from "@/components/dashboard/history/run-links";
import { SharedRestoreDialog } from "@/components/dashboard/shared/shared-restore-dialog";
import { backupRef, restoreStarted, type SharedRow } from "@/components/dashboard/shared/shared-model";
import { useBackUpNow } from "@/components/dashboard/shared/use-back-up-now";
import { useDateFormatter } from "@/hooks/use-date-formatter";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import type { ProvidedDatabase } from "@/services/sharing/shared-server-rows";
import { sharedServerBackupsHref, sharedServerMenu, type SharedDatabaseHandlers, type SharedServerAccess } from "./shared-server-actions";
import { SharedServerDetails } from "./shared-server-details";
import { SharedServerContextMenu, SharedServerRowMenu } from "./shared-server-menus";
import type { AdapterConfig } from "./types";

const log = logger.child({ component: "use-shared-servers" });

interface SharedServersOptions {
    configs: AdapterConfig[];
    /** The permissions of the viewer, which decide the entries. The actions check them again. */
    permissions: string[];
    /** Loads the list again, once a backup started or ended. */
    onChanged: () => void;
    /** Opens the details of a row, Show details of its menu. */
    onOpen: (config: AdapterConfig) => void;
}

/**
 * The servers of other tenants in the list of databases: their menus, their panel and what those
 * start. Back up now of a database follows its run through `useBackUpNow`, a restore asks in the
 * short restore dialog of a shared database, and a download hands out the dump of the one database.
 * The rights are the ones those actions check: Run now of a job, the restore and the download of backups.
 */
export function useSharedServers({ configs, permissions, onChanged, onOpen }: SharedServersOptions) {
    const router = useRouter();
    const { formatDate } = useDateFormatter();
    const access: SharedServerAccess = useMemo(() => ({
        canBackUp: permissions.includes(PERMISSIONS.JOBS.EXECUTE),
        canRestore: permissions.includes(PERMISSIONS.STORAGE.RESTORE),
        canViewBackups: permissions.includes(PERMISSIONS.STORAGE.READ),
        canDownload: permissions.includes(PERMISSIONS.STORAGE.DOWNLOAD),
    }), [permissions]);
    const canViewHistory = permissions.includes(PERMISSIONS.HISTORY.READ);

    const databases = useMemo(() => configs.flatMap((config) => config.sharedServer?.databases.map((entry) => entry.database) ?? []), [configs]);
    const openRun = useMemo(() => (canViewHistory ? (executionId: string) => router.push(runHref(executionId, "connections")) : undefined), [canViewHistory, router]);
    const backups = useBackUpNow({ databases, canBackUp: access.canBackUp, onChanged, openRun });
    const [restoring, setRestoring] = useState<SharedRow | null>(null);
    const [pending, setPending] = useState(false);
    const [downloading, setDownloading] = useState<string | null>(null);

    const groupsFor = useCallback((config: AdapterConfig) => {
        const terms = config.sharedServer;
        if (!terms) return [];
        return sharedServerMenu(terms, access, {
            onBackUp: (database) => void backups.backUp(database),
            onShowDetails: () => onOpen(config),
            onShowBackups: () => router.push(sharedServerBackupsHref(terms)),
            starting: backups.starting,
        });
    }, [access, backups, onOpen, router]);

    const download = useCallback(async ({ newest }: ProvidedDatabase) => {
        if (!newest) return;
        setDownloading(newest.id);
        try {
            const result = await downloadSharedBackup(backupRef(newest));
            if (!result.success) {
                toast.error(result.error);
                return;
            }
            toast.success(`The download of ${result.data.fileName} starts`);
            window.location.assign(result.data.url);
        } catch (error: unknown) {
            log.warn("Preparing a shared download failed", { sourceId: newest.sourceId }, wrapError(error));
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
                ...(canViewHistory ? { action: { label: "Open the run", onClick: () => router.push(runHref(executionId, "connections")) } } : {}),
            });
            setRestoring(null);
        } catch (error: unknown) {
            log.warn("Starting a shared restore failed", { sourceId: restoring.sourceId }, wrapError(error));
            toast.error("The restore could not be started.");
        } finally {
            setPending(false);
        }
    };

    const databaseHandlers: SharedDatabaseHandlers = useMemo(() => ({
        onRestore: ({ database, newest }) => newest && setRestoring({ ...newest, database }),
        onDownload: (entry) => void download(entry),
        downloading: downloading !== null,
        when: (iso) => formatDate(iso, "Pp"),
    }), [download, downloading, formatDate]);

    /** The button at the end of the row. */
    const rowMenu = useCallback((config: AdapterConfig) =>
        config.sharedServer ? <SharedServerRowMenu terms={config.sharedServer} adapterId={config.adapterId} groups={groupsFor(config)} /> : null, [groupsFor]);

    /** The right click menu of the row. */
    const contextMenu = useCallback((config: AdapterConfig) =>
        config.sharedServer ? <SharedServerContextMenu terms={config.sharedServer} adapterId={config.adapterId} groups={groupsFor(config)} /> : null, [groupsFor]);

    /** The details, in the side panel or beside the list of the split view. */
    const panel = useCallback((config: AdapterConfig, variant: "sheet" | "inline") =>
        config.sharedServer ? (
            <SharedServerDetails
                key={config.id}
                variant={variant}
                config={config}
                terms={config.sharedServer}
                access={access}
                starting={backups.starting}
                onBackUp={(database) => void backups.backUp(database)}
                handlers={databaseHandlers}
            />
        ) : null, [access, backups, databaseHandlers]);

    const dialogs = restoring ? (
        <SharedRestoreDialog
            row={restoring}
            databases={databases}
            pending={pending}
            onClose={() => !pending && setRestoring(null)}
            onConfirm={() => void restore()}
            backupNote={`The newest backup of ${restoring.database.databaseName}.`}
        />
    ) : null;

    return { rowMenu, contextMenu, panel, dialogs };
}
