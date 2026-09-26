"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyResolutionResult } from "@/components/common/encryption-key-resolution-dialog";
import { keyOverrideBody, type KeyOverrideBody } from "@/hooks/use-encryption-key-recovery";
import type { DownloadItem } from "./download-model";

interface AnalyzeResponse {
    databases?: string[];
    databaseDetails?: { name: string; size?: number }[];
    directories?: { jobSourceId: string; label: string; fileCount: number; totalSize: number; origin?: { path: string } }[];
    error?: string;
}

export interface BackupContents {
    loading: boolean;
    error: string | null;
    databases: DownloadItem[];
    folders: DownloadItem[];
}

/** The page's key prompt, which answers a request that needs a key and runs it again. */
export type InterceptKeyRequest = (response: Response, retry: (result: KeyResolutionResult) => void | Promise<void>) => Promise<boolean>;

const EMPTY: BackupContents = { loading: false, error: null, databases: [], folders: [] };

/**
 * The databases and folders a seekable backup holds, read from its index once the dialog opens.
 * An older backup has no index, so there is nothing to pick and nothing is loaded.
 */
export function useBackupContents(params: {
    open: boolean;
    destinationId: string;
    file: { path: string; sourceType?: string; hasFileIndex?: boolean } | null;
    keyOverride?: KeyOverrideBody;
    interceptKeyRequest: InterceptKeyRequest;
}): BackupContents & { retry: () => void } {
    const { open, destinationId, file, keyOverride } = params;
    const [contents, setContents] = useState<BackupContents>(EMPTY);
    // Held in a ref, so a parent handing a new function on every render does not load again.
    const intercept = useRef(params.interceptKeyRequest);
    useEffect(() => {
        intercept.current = params.interceptKeyRequest;
    }, [params.interceptKeyRequest]);

    const load = useCallback(async (resolved?: KeyResolutionResult) => {
        if (!file?.hasFileIndex) return;
        setContents({ ...EMPTY, loading: true });
        try {
            const res = await fetch(`/api/storage/${destinationId}/analyze`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ file: file.path, type: file.sourceType, ...(resolved ? keyOverrideBody(resolved) : keyOverride) }),
            });
            if (await intercept.current(res, (result) => load(result))) {
                setContents(EMPTY);
                return;
            }
            const data: AnalyzeResponse = await res.json().catch(() => ({}));
            if (!res.ok) {
                setContents({ ...EMPTY, error: data.error ?? "This backup could not be read." });
                return;
            }
            const sizes = new Map((data.databaseDetails ?? []).map((detail) => [detail.name, detail.size ?? null]));
            const names = data.databaseDetails?.map((detail) => detail.name) ?? data.databases ?? [];
            setContents({
                loading: false,
                error: null,
                databases: names.map((name) => ({ id: name, name, detail: "Dump, decrypted and unpacked", size: sizes.get(name) ?? null })),
                folders: (data.directories ?? []).map((folder) => ({
                    id: folder.jobSourceId,
                    name: folder.label,
                    detail: [folder.origin?.path, `${folder.fileCount.toLocaleString()} files`].filter(Boolean).join(" · "),
                    size: folder.totalSize,
                })),
            });
        } catch (e: unknown) {
            setContents({ ...EMPTY, error: e instanceof Error ? e.message : "This backup could not be read." });
        }
    }, [destinationId, file, keyOverride]);

    useEffect(() => {
        if (open) void load();
    }, [open, load]);

    return { ...contents, retry: () => void load() };
}
