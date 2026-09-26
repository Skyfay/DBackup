"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyResolutionResult } from "@/components/common/encryption-key-resolution-dialog";
import type { FileInfo } from "@/components/dashboard/storage/file-info";
import { keyOverrideBody, useEncryptionKeyRecovery, type KeyOverrideBody } from "@/hooks/use-encryption-key-recovery";

/** A folder source inside the backup, from the analysis. */
export interface DirectoryAnalysis {
    jobSourceId: string;
    label: string;
    fileCount: number;
    totalSize: number;
    excludePatterns: string[];
    /** Where it was collected, while that source still exists. */
    origin?: { configId: string; configName: string; path: string };
}

/** Where a snapshot sits in its incremental chain. */
export interface ChainInfo {
    type: "full" | "incremental";
    index: number;
    deps: string[];
}

export interface RestoreAnalysis {
    loading: boolean;
    /** Why the backup could not be read, so the page says so instead of staying empty. */
    error: string | null;
    sourceType: string;
    databases: string[];
    /** Bytes of each database in the backup, for backups that record it. */
    sizes: Map<string, number>;
    directories: DirectoryAnalysis[];
    chain: ChainInfo | null;
}

interface AnalyzeResponse {
    sourceType?: string;
    databases?: string[];
    databaseDetails?: { name: string; size: number }[];
    directories?: DirectoryAnalysis[];
    chain?: ChainInfo;
    error?: string;
}

/**
 * Reads what a backup holds, once, and keeps the answer to a key prompt for every later request.
 *
 * Opening a backup takes several requests, the analysis, a folder of the tree, the dry run and
 * the restore itself, and all of them need the key the prompt resolved. It is held in a ref, so a
 * retry in the same tick as the answer already carries it.
 */
export function useRestoreAnalysis(file: FileInfo | null, destinationId: string, wanted: { databases: boolean; files: boolean }, skip: boolean) {
    const keyRecovery = useEncryptionKeyRecovery();
    const { intercept: interceptKeyRequest } = keyRecovery;
    const keyOverrideRef = useRef<KeyOverrideBody>({});
    const applyKeyResolution = useCallback((result?: KeyResolutionResult): KeyOverrideBody => {
        if (result) keyOverrideRef.current = keyOverrideBody(result);
        return keyOverrideRef.current;
    }, []);

    const [analysis, setAnalysis] = useState<RestoreAnalysis>({
        loading: !skip && !!file?.sourceType, error: null, sourceType: "", databases: [], sizes: new Map(), directories: [], chain: null,
    });

    const analyze = useCallback(async (target: FileInfo, resolvedKey?: KeyResolutionResult) => {
        setAnalysis((current) => ({ ...current, loading: true }));
        try {
            const res = await fetch(`/api/storage/${destinationId}/analyze`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ file: target.path, type: target.sourceType, ...applyKeyResolution(resolvedKey) }),
            });
            // No key means no file index, and no index an empty page. Asking for one answers it.
            if (await interceptKeyRequest(res, (result) => analyze(target, result))) return;
            const data: AnalyzeResponse = await res.json().catch(() => ({}));
            if (!res.ok) {
                setAnalysis((current) => ({ ...current, loading: false, error: data.error ?? "This backup could not be read." }));
                return;
            }
            setAnalysis({
                loading: false,
                error: null,
                sourceType: data.sourceType ?? "",
                databases: wanted.databases ? data.databases ?? [] : [],
                sizes: new Map((data.databaseDetails ?? []).map((detail) => [detail.name, detail.size])),
                directories: wanted.files ? data.directories ?? [] : [],
                chain: data.chain ?? null,
            });
        } catch (error: unknown) {
            setAnalysis((current) => ({ ...current, loading: false, error: error instanceof Error ? error.message : "This backup could not be read." }));
        }
    }, [destinationId, wanted.databases, wanted.files, interceptKeyRequest, applyKeyResolution]);

    // A config backup of DBackup has nothing to analyze, it restores as a whole.
    useEffect(() => {
        if (file?.sourceType && !skip) void analyze(file);
    }, [file, skip, analyze]);

    const retry = useCallback(() => {
        if (file) void analyze(file);
    }, [file, analyze]);

    return { analysis, retry, keyRecovery, interceptKeyRequest, applyKeyResolution, keyOverrideRef };
}
