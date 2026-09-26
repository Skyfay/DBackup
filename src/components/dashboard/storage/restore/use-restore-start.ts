"use client";

import { useCallback, useState, type MutableRefObject } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { FileInfo } from "@/components/dashboard/storage/file-info";
import type { RestoreMode } from "@/components/dashboard/storage/restore-scope";
import type { KeyOverrideBody } from "@/hooks/use-encryption-key-recovery";
import { useUserPreferences } from "@/hooks/use-user-preferences";
import type { DbChoice, FolderChoice } from "./restore-model";

/** Why the server turned a start down, and whether an admin login could help. */
export interface RestoreFailure {
    error: string;
    needsAdmin: boolean;
}

/** The login a server usually has for creating databases, as the first guess of the form. */
const ADMIN_USERS: Record<string, string> = { postgres: "postgres", mssql: "sa", "azure-sql": "sa", mongodb: "admin" };

interface Options {
    file: FileInfo | null;
    destinationId: string;
    scope: RestoreMode;
    sourceType: string;
    target: string;
    /** Every database with whether it is picked. Sent whole, since a missing one means all of them. */
    choices: DbChoice[];
    classicName: string;
    folders: FolderChoice[];
    excludePatterns: string[];
    keyOverrideRef: MutableRefObject<KeyOverrideBody>;
}

/**
 * Starts a restore. It runs in the background, so success moves on to its run in History or back
 * to the Storage Explorer. A start the server turns down keeps the page and says why.
 */
export function useRestoreStart(options: Options) {
    const { file, destinationId, scope, sourceType, target, choices, classicName, folders, excludePatterns, keyOverrideRef } = options;
    const router = useRouter();
    const { autoRedirectOnJobStart } = useUserPreferences();
    const [restoring, setRestoring] = useState(false);
    const [failure, setFailure] = useState<RestoreFailure | null>(null);
    const [adminUser, setAdminUser] = useState(ADMIN_USERS[sourceType.toLowerCase()] ?? "root");
    const [adminPassword, setAdminPassword] = useState("");

    const start = useCallback(async (withAdmin = false) => {
        if (!file) return;
        setRestoring(true);
        try {
            const payload = {
                file: file.path,
                // Tells the server which half was asked for, so the half this page never showed is not read as all of it.
                scope,
                targetSourceId: target || undefined,
                targetDatabaseName: classicName.trim() || undefined,
                databaseMapping: choices.length > 0 ? choices.map((choice) => ({ originalName: choice.name, targetName: choice.targetName, selected: choice.selected })) : undefined,
                directoryMapping: folders.length > 0
                    ? folders.map((folder) => ({
                        entryId: folder.entryId,
                        targetConfigId: folder.targetConfigId,
                        targetPath: folder.targetPath.trim(),
                        selected: folder.selected,
                        ...(folder.selection !== null ? { paths: folder.selection } : {}),
                    }))
                    : undefined,
                ...(excludePatterns.length > 0 ? { excludePatterns } : {}),
                privilegedAuth: withAdmin ? { user: adminUser, password: adminPassword } : undefined,
                // The run happens in the background with nobody to ask, so the key travels with it.
                ...keyOverrideRef.current,
            };
            const res = await fetch(`/api/storage/${destinationId}/restore`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            const data: { success?: boolean; executionId?: string; error?: string } = await res.json().catch(() => ({}));
            if (res.ok && data.success) {
                toast.success("Restore started in the background");
                router.push(autoRedirectOnJobStart && data.executionId
                    ? `/dashboard/history?executionId=${data.executionId}&autoOpen=true`
                    : `/dashboard/storage?at=${encodeURIComponent(destinationId)}`);
                return;
            }
            const error = data.error || "The restore could not start";
            setFailure({ error, needsAdmin: /access denied|permission denied|user permissions\?/i.test(error) });
        } catch {
            setFailure({ error: "The restore could not start, the request failed.", needsAdmin: false });
        } finally {
            setRestoring(false);
        }
    }, [file, scope, target, classicName, choices, folders, excludePatterns, adminUser, adminPassword, keyOverrideRef, destinationId, router, autoRedirectOnJobStart]);

    return { restoring, failure, dismissFailure: () => setFailure(null), start, adminUser, setAdminUser, adminPassword, setAdminPassword };
}
