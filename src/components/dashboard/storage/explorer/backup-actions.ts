import type * as React from "react";
import { Database, Download, FileCheck, FileLock2, FolderInput, Layers, Lock, LockOpen, PackageOpen, RotateCcw, ShieldCheck, Terminal, Trash2 } from "lucide-react";
import { getDownloadOptions } from "@/components/dashboard/storage/download-options";
import { needsRestoreScopeChoice, type RestoreMode } from "@/components/dashboard/storage/restore-scope";
import type { Tone } from "@/components/ui/tone";
import type { ExplorerFile } from "@/services/storage/explorer-types";

export interface BackupAction {
    id: string;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    onSelect: () => void;
    disabled?: boolean;
    /** The task of what the action opens, which colors its entry in the menus. */
    tone: Tone;
}

export interface BackupActionGroup {
    label?: string;
    actions: BackupAction[];
}

export interface BackupActionHandlers {
    onRestore?: (mode?: RestoreMode) => void;
    onDownload?: (decrypt: boolean) => void;
    /** Everything in the backup, or a whole snapshot out of its chain, as a tar.gz. */
    onDownloadContents?: () => void;
    /** Picks one database out of several. */
    onDownloadDatabase?: () => void;
    onLink?: () => void;
    onVerify?: () => void;
    onToggleLock?: () => void;
    onDelete?: () => void;
}

const ARCHIVED_STORAGE_CLASSES = ["GLACIER", "DEEP_ARCHIVE"];

/** A backup in S3 Glacier or Deep Archive, which has to be restored in AWS before anything can read it. */
export function isArchived(file: Pick<ExplorerFile, "storageClass">): boolean {
    return ARCHIVED_STORAGE_CLASSES.includes(file.storageClass ?? "");
}

/**
 * Everything one backup can do, as data.
 *
 * The button at the end of a row, the right click menu and the menu of the details render the same
 * list, so they never drift apart. Actions the user may not take have no handler and are left out.
 */
export function backupActions(file: ExplorerFile, handlers: BackupActionHandlers): BackupActionGroup[] {
    const archived = isArchived(file);
    const restore: BackupAction[] = [];
    if (handlers.onRestore) {
        const onRestore = handlers.onRestore;
        if (needsRestoreScopeChoice(file.combined)) {
            // The backup holds databases and folders, so the menu asks what to bring back.
            restore.push(
                { id: "restore-all", label: "Restore everything", icon: Layers, onSelect: () => onRestore("all"), disabled: archived, tone: "warning" },
                { id: "restore-databases", label: "Restore databases only", icon: Database, onSelect: () => onRestore("databases"), disabled: archived, tone: "warning" },
                { id: "restore-files", label: "Restore files only", icon: FolderInput, onSelect: () => onRestore("files"), disabled: archived, tone: "warning" },
            );
        } else {
            restore.push({ id: "restore", label: "Restore", icon: RotateCcw, onSelect: () => onRestore(), disabled: archived, tone: "warning" });
        }
    }

    const download: BackupAction[] = [];
    if (handlers.onDownload) {
        const onDownload = handlers.onDownload;
        const options = getDownloadOptions(file);
        download.push({ id: "download", label: options.raw.label, icon: file.isEncrypted ? FileLock2 : Download, onSelect: () => onDownload(false), disabled: archived, tone: "neutral" });
        if (options.decrypted) {
            download.push({ id: "download-decrypted", label: options.decrypted.label, icon: FileCheck, onSelect: () => onDownload(true), disabled: archived, tone: "neutral" });
        }
        if (options.pickDatabase && handlers.onDownloadDatabase) {
            download.push({ id: "download-database", label: options.pickDatabase.label, icon: Database, onSelect: handlers.onDownloadDatabase, disabled: archived, tone: "neutral" });
        }
        if (options.contents && handlers.onDownloadContents) {
            download.push({ id: "download-contents", label: options.contents.label, icon: PackageOpen, onSelect: handlers.onDownloadContents, disabled: archived, tone: "neutral" });
        }
        if (handlers.onLink) {
            download.push({ id: "link", label: "wget / curl link", icon: Terminal, onSelect: handlers.onLink, disabled: archived, tone: "neutral" });
        }
    }

    const manage: BackupAction[] = [
        ...(handlers.onVerify ? [{ id: "verify", label: "Verify integrity", icon: ShieldCheck, onSelect: handlers.onVerify, tone: "neutral" as const }] : []),
        ...(handlers.onToggleLock
            ? [{ id: "lock", label: file.locked ? "Unlock" : "Lock", icon: file.locked ? LockOpen : Lock, onSelect: handlers.onToggleLock, tone: "neutral" as const }]
            : []),
    ];
    const remove: BackupAction[] = handlers.onDelete
        ? [{ id: "delete", label: "Delete", icon: Trash2, onSelect: handlers.onDelete, disabled: file.locked, tone: "destructive" }]
        : [];

    return [
        ...(restore.length > 0 ? [{ label: "Restore", actions: restore }] : []),
        ...(download.length > 0 ? [{ label: "Download", actions: download }] : []),
        ...(manage.length > 0 ? [{ label: "Manage", actions: manage }] : []),
        ...(remove.length > 0 ? [{ actions: remove }] : []),
    ];
}
