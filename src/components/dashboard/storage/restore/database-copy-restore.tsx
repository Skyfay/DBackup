"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RotateCw } from "lucide-react";
import { RestartWait } from "@/components/config-restore/restart-wait";
import { RestoreContents } from "@/components/config-restore/restore-contents";
import { EncryptionKeyResolutionDialog, type KeyResolutionResult } from "@/components/common/encryption-key-resolution-dialog";
import type { FileInfo } from "@/components/dashboard/storage/file-info";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import type { RestorePreview } from "@/lib/types/config-backup";
import { RestoreBar } from "./restore-frame";
import { Notice, Section } from "./restore-parts";

const log = logger.child({ component: "database-copy-restore" });

/** A configuration backup that is a copy of the whole database, not a file of an older version with parts. */
export function isDatabaseCopyFile(name: string): boolean {
    return /\.db(\.|$)/.test(name);
}

interface Checked {
    token: string;
    fileName: string;
    preview: RestorePreview;
}

interface Answer<T> {
    success: boolean;
    error?: string;
    code?: string;
    profileId?: string;
    data?: T;
}

interface DatabaseCopyRestoreProps {
    file: FileInfo;
    destinationId: string;
    /** Only a SuperAdmin restores a configuration, since it could make anyone a SuperAdmin. */
    canRestore: boolean;
    canManageVault: boolean;
    onCancel: () => void;
}

async function post<T>(url: string, body: object): Promise<Answer<T>> {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return (await response.json().catch(() => ({ success: false }))) as Answer<T>;
}

/**
 * A copy of the whole database at a destination, read on the server and shown with what it holds.
 * Replace and restart makes it the database of this DBackup, which restarts with it.
 */
export function DatabaseCopyRestore({ file, destinationId, canRestore, canManageVault, onCancel }: DatabaseCopyRestoreProps) {
    const [checked, setChecked] = useState<Checked | null>(null);
    const [reading, setReading] = useState(false);
    const [problem, setProblem] = useState<string | null>(null);
    const [confirming, setConfirming] = useState(false);
    const [restoring, setRestoring] = useState(false);
    const [restarting, setRestarting] = useState(false);
    const [keyDialog, setKeyDialog] = useState<{ open: boolean; profileId: string }>({ open: false, profileId: "" });

    const read = useCallback(async (key?: { keyHex?: string; profileId?: string }) => {
        setReading(true);
        setProblem(null);
        try {
            const answer = await post<Checked>("/api/settings/config-backup/restore/destination", { destinationId, file: file.path, ...key });
            if (answer.success && answer.data) setChecked(answer.data);
            else if (answer.code === "ENCRYPTION_KEY_REQUIRED") setKeyDialog({ open: true, profileId: answer.profileId ?? "" });
            else setProblem(answer.error ?? "The backup could not be read.");
        } catch (error: unknown) {
            log.warn("Reading a configuration backup failed", { destinationId }, wrapError(error));
            setProblem("The backup could not be read.");
        } finally {
            setReading(false);
        }
    }, [destinationId, file.path]);

    useEffect(() => {
        if (canRestore) void read();
    }, [canRestore, read]);

    const restore = async () => {
        if (!checked) return;
        setRestoring(true);
        try {
            const answer = await post<{ restarting?: boolean }>("/api/settings/config-backup/restore/apply", { token: checked.token });
            if (answer.success && answer.data?.restarting) {
                setRestarting(true);
                return;
            }
            setProblem(answer.error ?? "The restore failed.");
        } catch (error: unknown) {
            log.warn("Restoring a configuration failed", { destinationId }, wrapError(error));
            setProblem("The restore failed.");
        } finally {
            setRestoring(false);
            setConfirming(false);
        }
    };

    const withKey = (result: KeyResolutionResult) => {
        setKeyDialog({ open: false, profileId: "" });
        void read(result.type === "rawKey" ? { keyHex: result.keyHex } : { profileId: result.profileId });
    };

    if (restarting) {
        return (
            <Section title="Restoring the configuration">
                <RestartWait />
            </Section>
        );
    }

    const blocker = !canRestore
        ? "Only a SuperAdmin restores the configuration"
        : reading
            ? "Reading the backup"
            : !checked
                ? "The backup could not be read"
                : null;

    return (
        <div className="space-y-4 md:space-y-6">
            <Notice tone="destructive" title="This replaces everything in this DBackup">
                Connections, jobs, users, the settings and the history become the ones of the backup, and DBackup restarts. The database of now stays beside it as dbackup.db.before-restore.
            </Notice>
            <Section title="What comes back" note="A copy of the whole database of DBackup">
                {!canRestore ? (
                    <p className="text-sm text-muted-foreground">Only a SuperAdmin restores the configuration, since it brings back users, groups and sign-in providers.</p>
                ) : reading ? (
                    <p className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                        Reading the backup
                    </p>
                ) : problem ? (
                    <Notice tone="destructive" title="This backup could not be read">
                        {problem}{" "}
                        <Button variant="link" className="h-auto p-0" onClick={() => void read()}>Try again</Button>
                    </Notice>
                ) : checked ? (
                    <RestoreContents preview={checked.preview} fileName={checked.fileName} />
                ) : null}
            </Section>
            <RestoreBar
                title="Replaces the configuration of this DBackup"
                detail={checked ? "Everyone signs in again afterwards, with an account of the backup" : ""}
                blocker={blocker}
                onCancel={onCancel}
                action={{ label: "Replace and restart", onClick: () => setConfirming(true), pending: restoring, tone: "destructive" }}
            />
            <ConfirmDialog
                open={confirming}
                onOpenChange={setConfirming}
                title="Replace the configuration and restart?"
                note="Everything here becomes the backup"
                destructive
                icon={RotateCw}
                confirmLabel="Replace and restart"
                isPending={restoring}
                onConfirm={() => void restore()}
            >
                <p className="text-sm text-muted-foreground">
                    DBackup is gone for about a minute. A backup or restore that runs right now keeps the restore waiting until it has ended.
                </p>
            </ConfirmDialog>
            <EncryptionKeyResolutionDialog
                open={keyDialog.open}
                onOpenChange={(open) => setKeyDialog((current) => ({ ...current, open }))}
                profileIdHint={keyDialog.profileId}
                backup={{ storageConfigId: destinationId, file: file.path }}
                canManageVault={canManageVault}
                onConfirm={withKey}
                loading={reading}
            />
        </div>
    );
}
