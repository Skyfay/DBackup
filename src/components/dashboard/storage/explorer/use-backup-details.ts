"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { BackupRun, ExplorerDestination, ExplorerFile, ExplorerJob, RunExecution } from "@/services/storage/explorer-types";
import type { BackupDetailsData } from "./backup-details";
import { byAnswer, primaryCopy, runKey } from "./backup-filters";
import { useExplorerData } from "./explorer-data";

/** The backups of a chain, oldest first, out of the files the page has. */
function chainOf(file: ExplorerFile, files: ExplorerFile[]): ExplorerFile[] | null {
    const id = file.chain?.id;
    if (!id) return null;
    return files.filter((entry) => entry.chain?.id === id).sort((a, b) => (a.chain?.index ?? 0) - (b.chain?.index ?? 0));
}

interface BackupDetailsInput {
    /** Every backup, null while they load or where no panel opens. */
    runs: BackupRun[] | null;
    /** The destinations of the filter, whose copies a restore prefers. */
    at: string[];
    jobsByKey: Map<string, ExplorerJob>;
    destinationsById: Map<string, ExplorerDestination>;
}

/**
 * The backup whose details show in the side panel. The panel follows its backup, so a reload after
 * a lock or a check shows the new state. History keeps no index by path, so the run that made a
 * backup is asked for when its details open. Whoever opens the panel may ask to be told once it is
 * gone, like the timeline, which opens its list again.
 */
export function useBackupDetails({ runs, at, jobsByKey, destinationsById }: BackupDetailsInput) {
    const [details, setDetails] = useState<{ open: boolean; key: string } | null>(null);
    const onClosedRef = useRef<(() => void) | null>(null);
    const run = details && runs ? runs.find((entry) => runKey(entry) === details.key) ?? null : null;
    const execution = useExplorerData<RunExecution | null>(run ? `/api/storage/explorer/execution?path=${encodeURIComponent(run.path)}` : null);

    const data = useMemo<BackupDetailsData | null>(() => {
        if (!run || !runs) return null;
        // A restore from the panel reads from a copy whose destination answers right now.
        const primary = primaryCopy(run, at, byAnswer(destinationsById));
        const siblings = runs.filter((entry) => entry.jobKey === run.jobKey).map((entry) => entry.file);
        return {
            file: primary.file,
            destinationId: primary.destinationId,
            copies: run.copies,
            job: jobsByKey.get(run.jobKey) ?? null,
            chain: chainOf(run.file, siblings),
            execution: execution.data ?? null,
        };
    }, [run, runs, at, execution.data, jobsByKey, destinationsById]);

    const openRun = useCallback((entry: BackupRun, onClosed?: () => void) => {
        onClosedRef.current = onClosed ?? null;
        setDetails({ open: true, key: runKey(entry) });
    }, []);
    const close = useCallback(() => setDetails((current) => (current ? { ...current, open: false } : null)), []);
    const reset = useCallback(() => {
        onClosedRef.current = null;
        setDetails(null);
    }, []);
    /** For `onCloseAutoFocus` of the panel: once it is gone, the one who opened it takes the focus. */
    const closed = useCallback((event: Event) => {
        const onClosed = onClosedRef.current;
        onClosedRef.current = null;
        if (!onClosed) return;
        event.preventDefault();
        onClosed();
    }, []);

    return { open: details?.open ?? false, run, data, openRun, close, reset, closed };
}
