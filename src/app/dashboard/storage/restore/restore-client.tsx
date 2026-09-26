"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, HardDrive } from "lucide-react";
import { EncryptionKeyResolutionDialog, type KeyResolutionResult } from "@/components/common/encryption-key-resolution-dialog";
import type { FileInfo } from "@/components/dashboard/storage/file-info";
import { startPreparedArchiveDownload } from "@/components/dashboard/storage/prepared-download";
import { normalizeRestoreScope, parseRestoreScope } from "@/components/dashboard/storage/restore-scope";
import { DatabaseStep } from "@/components/dashboard/storage/restore/database-step";
import { FolderStep } from "@/components/dashboard/storage/restore/folder-step";
import { RestoreConfirm } from "@/components/dashboard/storage/restore/restore-confirm";
import { RestoreBar, RestoreFailureCard, RestoreSteps, type RestoreStep } from "@/components/dashboard/storage/restore/restore-frame";
import { RedisGuide } from "@/components/dashboard/storage/restore/redis-guide";
import { RestoreHead } from "@/components/dashboard/storage/restore/restore-head";
import { databaseSentence, pickedCount, plural, restoreBlocker, restoreLabel } from "@/components/dashboard/storage/restore/restore-model";
import { Notice } from "@/components/dashboard/storage/restore/restore-parts";
import { SystemRestore } from "@/components/dashboard/storage/restore/system-restore";
import { useRestoreAnalysis } from "@/components/dashboard/storage/restore/use-restore-analysis";
import { useRestoreDatabases } from "@/components/dashboard/storage/restore/use-restore-databases";
import { useRestoreFolders } from "@/components/dashboard/storage/restore/use-restore-folders";
import { useRestoreStart } from "@/components/dashboard/storage/restore/use-restore-start";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ViewSwitch } from "@/components/ui/view-switch";
import type { ViewMode } from "@/lib/core/table-preferences";
import { decodeUrlPayload } from "@/lib/url-payload";
import { formatBytes } from "@/lib/utils";
import { computeRestoreValidity } from "./restore-validation";

const VIEWS: ViewMode[] = ["table", "lines"];

interface RestoreClientProps {
    /** Whether this user may create vault profiles, which key recovery does. */
    canManageVault?: boolean;
    /** Whether this user may download backups, which offers each database as a dump. */
    canDownload?: boolean;
}

/**
 * The restore page. The databases of a backup and the folders are two steps when a backup holds
 * both, first the databases, then the files. Each shows as rows beside what is there now, or as
 * lines from the backup to where it goes. The bar at the foot says what happens and starts it.
 */
export function RestoreClient({ canManageVault = false, canDownload = false }: RestoreClientProps) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const file = useMemo(() => decodeUrlPayload<FileInfo>(searchParams.get("file")), [searchParams]);
    const destinationId = searchParams.get("destinationId") ?? "";
    const mode = searchParams.get("mode");
    // Absent or "all" means everything, which is also what every older link resolves to.
    const scope = normalizeRestoreScope(mode);
    const { wantsDatabases, wantsFiles } = parseRestoreScope(mode);
    const type = (file?.sourceType ?? "").toLowerCase();
    const isSystem = file?.sourceType === "SYSTEM";
    const isRedis = type === "redis" || type === "valkey";
    const back = () => router.push(destinationId ? `/dashboard/storage?at=${encodeURIComponent(destinationId)}` : "/dashboard/storage");

    const { analysis, retry, keyRecovery, interceptKeyRequest, applyKeyResolution, keyOverrideRef } = useRestoreAnalysis(file, destinationId, { databases: wantsDatabases, files: wantsFiles }, isSystem || isRedis);
    const sourceType = analysis.sourceType || file?.sourceType || "";
    const databases = useRestoreDatabases(file, analysis.databases, analysis.sizes, sourceType);
    const folders = useRestoreFolders({ file, destinationId, directories: analysis.directories, applyKeyResolution, interceptKeyRequest });
    const run = useRestoreStart({
        file, destinationId, scope, sourceType, target: databases.target, choices: databases.choices, classicName: databases.classicName,
        folders: folders.folders, excludePatterns: folders.excludePatterns, keyOverrideRef,
    });
    const [step, setStep] = useState<RestoreStep>("databases");
    const [view, setView] = useState<ViewMode>("table");
    const [confirming, setConfirming] = useState(false);

    if (!file || !destinationId) {
        return (
            <div className="rounded-xl border border-dashed bg-card px-4 py-16 text-center shadow-sm">
                <HardDrive className="mx-auto mb-4 size-10 text-muted-foreground/40" aria-hidden="true" />
                <p className="font-medium">No backup is picked</p>
                <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">Open a backup in the Storage Explorer and pick Restore.</p>
                <Button variant="outline" className="mt-4" onClick={() => router.push("/dashboard/storage")}>
                    <ArrowLeft />
                    Back to the Storage Explorer
                </Button>
            </div>
        );
    }

    const directoryOnly = sourceType.toLowerCase() === "directory-only" || !wantsDatabases;
    const hasFolders = analysis.directories.length > 0;
    const twoSteps = !directoryOnly && hasFolders;
    const current: RestoreStep = twoSteps ? step : directoryOnly ? "files" : "databases";
    const named = analysis.databases.length > 0;

    const validity = computeRestoreValidity({
        dbSelections: databases.choices, dirSelections: folders.folders, hasDirectories: hasFolders, analyzedDbCount: analysis.databases.length,
        isDirectoryOnly: directoryOnly, targetSourceId: databases.target, planError: folders.planError,
    });
    const serverName = databases.options.find((option) => option.id === databases.target)?.name ?? null;
    const dbCount = named ? pickedCount(databases.rows) : validity.classicMode ? 1 : 0;
    const folderCount = folders.folders.filter((folder) => folder.selected).length;
    const blocker = analysis.loading
        ? "Reading what the backup holds"
        : databases.loadingServer
            ? "Looking at the server"
            : restoreBlocker({
                needsServer: validity.dbTargetNeeded,
                server: databases.target,
                blockedBy: databases.compatibility && !databases.compatibility.ok ? databases.compatibility.text : null,
                anything: validity.atLeastOneSelected,
                folders: folders.folders,
                planError: folders.planError,
            });

    const what = [dbCount > 0 ? `${plural(dbCount, "database")}${serverName ? ` into ${serverName}` : ""}` : null, folderCount > 0 ? plural(folderCount, "folder") : null].filter(Boolean);
    const title = what.length > 0 ? `Restores ${what.join(" and ")}` : "Nothing is picked yet";
    const detail = [
        named ? databaseSentence(databases.rows) : validity.classicMode ? (databases.classicName ? `The dump comes back as ${databases.classicName}` : "The dump goes back into its original database") : null,
        folders.plan ? `${folders.plan.fileCount.toLocaleString()} files, ${formatBytes(folders.plan.totalBytes)}` : null,
    ].filter(Boolean).join(" · ");

    const downloadDatabase = async (name: string, resolvedKey?: KeyResolutionResult): Promise<void> => {
        await startPreparedArchiveDownload({
            destinationId,
            body: { file: file.path, databases: [name], ...applyKeyResolution(resolvedKey) },
            intercept: (res) => interceptKeyRequest(res, (result) => void downloadDatabase(name, result)),
            preparingLabel: `Preparing ${name}...`,
        });
    };

    const start = async (withAdmin: boolean) => {
        await run.start(withAdmin);
        setConfirming(false);
    };

    let body: React.ReactNode;
    if (isRedis) {
        body = <RedisGuide file={file} destinationId={destinationId} engine={type === "valkey" ? "Valkey" : "Redis"} canDownload={canDownload} />;
    } else if (isSystem) {
        body = <SystemRestore file={file} destinationId={destinationId} onCancel={back} />;
    } else {
        body = (
            <>
                {analysis.error && (
                    <Notice tone="destructive" title="This backup could not be read">
                        {analysis.error}{" "}
                        <Button variant="link" className="h-auto p-0" onClick={retry}>Try again</Button>
                    </Notice>
                )}
                {run.failure && (
                    <RestoreFailureCard
                        failure={run.failure}
                        onDismiss={run.dismissFailure}
                        adminUser={run.adminUser}
                        onAdminUser={run.setAdminUser}
                        adminPassword={run.adminPassword}
                        onAdminPassword={run.setAdminPassword}
                        restoring={run.restoring}
                        onRetry={() => void start(true)}
                    />
                )}
                {twoSteps && (
                    <RestoreSteps
                        step={current}
                        onStep={setStep}
                        databases={{ detail: `${dbCount} of ${analysis.databases.length} picked${serverName ? ` · into ${serverName}` : " · no server yet"}`, done: !validity.dbTargetNeeded || !!databases.target }}
                        files={{ detail: `${folderCount} of ${analysis.directories.length} folders${folders.plan ? ` · ${formatBytes(folders.plan.totalBytes)}` : ""}`, done: validity.dirSelectionValid && folderCount > 0 }}
                    />
                )}
                {current === "databases" ? (
                    <DatabaseStep databases={databases} named={named} loading={analysis.loading} canDownload={canDownload && !!file.hasFileIndex} view={view} onView={setView} onDownload={(name) => void downloadDatabase(name)} />
                ) : analysis.loading ? (
                    <Skeleton className="h-64 w-full rounded-xl" />
                ) : hasFolders ? (
                    <FolderStep
                        folders={folders}
                        directories={analysis.directories}
                        chain={analysis.chain}
                        file={file.path}
                        destinationId={destinationId}
                        canDownload={canDownload}
                        profileIdOverride={keyRecovery.override?.profileIdOverride}
                        view={view === "lines" ? "lines" : "table"}
                        toolbarEnd={<ViewSwitch value={view} onChange={setView} views={VIEWS} />}
                    />
                ) : (
                    !analysis.error && <Notice tone="warning" title="Nothing to restore here">This backup holds no folder this page can restore.</Notice>
                )}
                <RestoreBar
                    title={title}
                    detail={detail}
                    blocker={twoSteps && current === "databases" ? null : blocker}
                    onCancel={back}
                    onBack={twoSteps && current === "files" ? () => setStep("databases") : undefined}
                    next={twoSteps && current === "databases" ? { label: "Next: files", onClick: () => setStep("files") } : undefined}
                    action={{ label: restoreLabel(dbCount, folderCount), onClick: () => setConfirming(true), pending: run.restoring }}
                />
                <RestoreConfirm
                    open={confirming}
                    onOpenChange={setConfirming}
                    rows={databases.rows}
                    singleDump={validity.classicMode ? { name: databases.classicName.trim() } : null}
                    folders={folders.folders}
                    targets={folders.targets}
                    serverName={serverName}
                    shapeOf={folders.shapeOf}
                    label={restoreLabel(dbCount, folderCount)}
                    pending={run.restoring}
                    onConfirm={() => void start(false)}
                />
            </>
        );
    }

    return (
        <div className="space-y-4 md:space-y-6">
            <RestoreHead file={file} destinationId={destinationId} scopeLabel={!wantsDatabases ? "Files only" : !wantsFiles ? "Databases only" : null} mode={mode} onBack={back} />
            {body}
            {/* Opens whenever a request reports that no available key opens this backup. */}
            <EncryptionKeyResolutionDialog
                open={keyRecovery.open}
                onOpenChange={keyRecovery.onOpenChange}
                profileIdHint={keyRecovery.profileIdHint}
                backup={{ storageConfigId: destinationId, file: file.path }}
                canManageVault={canManageVault}
                onConfirm={keyRecovery.onConfirm}
                loading={keyRecovery.loading}
                error={keyRecovery.error}
            />
        </div>
    );
}
