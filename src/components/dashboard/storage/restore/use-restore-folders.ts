"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ExcludePatternPreset } from "@prisma/client";
import { getExcludePatternPresets } from "@/app/actions/templates";
import type { KeyResolutionResult } from "@/components/common/encryption-key-resolution-dialog";
import type { AdapterOption } from "@/components/dashboard/jobs/job-form-schema";
import type { FileInfo } from "@/components/dashboard/storage/file-info";
import { startPreparedArchiveDownload } from "@/components/dashboard/storage/prepared-download";
import type { KeyOverrideBody } from "@/hooks/use-encryption-key-recovery";
import { ADAPTER_DEFINITIONS } from "@/lib/adapters/definitions";
import { parseJsonStringArray, resolveExcludePatterns } from "@/lib/exclude-groups";
import type { FolderChoice } from "./restore-model";
import type { DirectoryAnalysis } from "./use-restore-analysis";

/** What the dry run found for the picked files. */
export interface RestorePlan {
    fileCount: number;
    totalBytes: number;
    /** The destination cannot serve byte ranges, so the whole archive is read once. */
    fullDownload: boolean;
}

interface Options {
    file: FileInfo | null;
    destinationId: string;
    directories: DirectoryAnalysis[];
    applyKeyResolution: (result?: KeyResolutionResult) => KeyOverrideBody;
    interceptKeyRequest: (res: Response, retry: (result: KeyResolutionResult) => void) => Promise<boolean>;
}

/**
 * The folders of a backup and where they go: a directory source and a path for each, the files
 * picked in its tree, patterns to leave out, and what the server says the pick holds.
 */
export function useRestoreFolders({ file, destinationId, directories, applyKeyResolution, interceptKeyRequest }: Options) {
    // Only directory sources: loose files dropped into a backup destination would mix with its backups.
    const [targets, setTargets] = useState<AdapterOption[]>([]);
    const [folders, setFolders] = useState<FolderChoice[]>([]);
    const [presets, setPresets] = useState<ExcludePatternPreset[]>([]);
    const [presetIds, setPresetIds] = useState<string[]>([]);
    const [custom, setCustom] = useState("");
    const [plan, setPlan] = useState<RestorePlan | null>(null);
    const [planError, setPlanError] = useState<string | null>(null);
    const hasFolders = directories.length > 0;

    useEffect(() => {
        let ignore = false;
        fetch("/api/adapters?type=storage&role=SOURCE")
            .then((res) => (res.ok ? res.json() : []))
            .then((data: AdapterOption[]) => !ignore && setTargets(data))
            .catch(() => undefined);
        return () => {
            ignore = true;
        };
    }, []);

    // Back where it was by default, while its source exists. Otherwise the user picks one.
    useEffect(() => {
        setFolders(directories.map((directory) => ({
            entryId: directory.jobSourceId,
            label: directory.label,
            targetConfigId: directory.origin?.configId ?? "",
            targetPath: directory.origin?.path ?? "",
            selected: true,
            selection: null,
        })));
    }, [directories]);

    // The presets starred as default apply here too, like for a new folder source.
    useEffect(() => {
        if (!hasFolders) return;
        void getExcludePatternPresets().then((res) => {
            if (!res.success || !res.data) return;
            setPresets(res.data);
            setPresetIds(res.data.filter((preset) => preset.isDefault).map((preset) => preset.id));
        });
    }, [hasFolders]);

    const excludePatterns = useMemo(() => {
        const fromPresets = presets.filter((preset) => presetIds.includes(preset.id)).flatMap((preset) => resolveExcludePatterns({
            groups: parseJsonStringArray(preset.groups),
            excludedGroupPatterns: parseJsonStringArray(preset.excludedGroupPatterns),
            patterns: parseJsonStringArray(preset.patterns),
        }));
        const typed = custom.split(/[\n,]/).map((pattern) => pattern.trim()).filter(Boolean);
        return [...new Set([...fromPresets, ...typed])];
    }, [presets, presetIds, custom]);

    const selections = useMemo(() => folders
        .filter((folder) => folder.selected && (folder.selection === null || folder.selection.length > 0))
        .map((folder) => ({ src: folder.entryId, ...(folder.selection !== null ? { paths: folder.selection } : {}) })), [folders]);
    // The dry run depends on what is picked, not on where it goes, so typing a path does not start it again.
    const planKey = JSON.stringify([selections, excludePatterns]);

    useEffect(() => {
        if (!file || !hasFolders) return;
        const [picked, patterns] = JSON.parse(planKey) as [typeof selections, string[]];
        if (picked.length === 0) {
            setPlan(null);
            setPlanError(null);
            return;
        }
        const run = async (resolvedKey?: KeyResolutionResult): Promise<void> => {
            try {
                const res = await fetch(`/api/storage/${destinationId}/restore-files`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ file: file.path, selections: picked, excludePatterns: patterns, target: { kind: "download" }, dryRun: true, ...applyKeyResolution(resolvedKey) }),
                });
                if (await interceptKeyRequest(res, (result) => run(result))) return;
                const data = await res.json();
                setPlan(data.success ? data.data : null);
                setPlanError(data.success ? null : data.error || "The picked files could not be resolved");
            } catch {
                // A network failure leaves the numbers out, it does not block the restore.
                setPlan(null);
                setPlanError(null);
            }
        };
        const timer = setTimeout(() => void run(), 500);
        return () => clearTimeout(timer);
    }, [file, hasFolders, planKey, destinationId, applyKeyResolution, interceptKeyRequest]);

    // Whether each target path holds something already, asked once it has stopped changing.
    useEffect(() => {
        const timers = folders
            .filter((folder) => folder.selected && folder.targetConfigId && folder.targetPath.trim() && folder.checkStatus === undefined)
            .map((folder) => setTimeout(async () => {
                const update = (checkStatus: FolderChoice["checkStatus"]) =>
                    setFolders((current) => current.map((entry) => (entry.entryId === folder.entryId ? { ...entry, checkStatus } : entry)));
                update("checking");
                try {
                    const res = await fetch(`/api/storage/${folder.targetConfigId}/check-path`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ path: folder.targetPath.trim() }),
                    });
                    const data = await res.json();
                    update(data.status || "unverified");
                } catch {
                    update("unverified");
                }
            }, 500));
        return () => timers.forEach(clearTimeout);
    }, [folders]);

    const change = useCallback((entryId: string, patch: Partial<FolderChoice>) => {
        setFolders((current) => current.map((folder) => (folder.entryId === entryId ? { ...folder, ...patch } : folder)));
    }, []);

    /** A flat adapter, like a Docker volume, is taken whole: its picker picks a volume, not a folder. */
    const shapeOf = useCallback((configId: string) => {
        const adapterId = targets.find((target) => target.id === configId)?.adapterId;
        const definition = ADAPTER_DEFINITIONS.find((entry) => entry.id === adapterId);
        return { flat: definition?.flatBrowse === true, noun: definition?.browseNoun ?? "folder" };
    }, [targets]);

    const downloadSelection = useCallback(async function download(resolvedKey?: KeyResolutionResult): Promise<void> {
        if (!file || selections.length === 0) return;
        await startPreparedArchiveDownload({
            destinationId,
            body: { file: file.path, selections, excludePatterns, ...applyKeyResolution(resolvedKey) },
            intercept: (res) => interceptKeyRequest(res, (result) => void download(result)),
            preparingLabel: "Preparing the picked files...",
        });
    }, [file, selections, excludePatterns, destinationId, applyKeyResolution, interceptKeyRequest]);

    return {
        targets, folders, change, shapeOf, presets, presetIds, setPresetIds, custom, setCustom, excludePatterns,
        plan, planError, selections, downloadSelection,
    };
}

export type RestoreFolders = ReturnType<typeof useRestoreFolders>;
