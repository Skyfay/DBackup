"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSharedOverview } from "@/app/actions/tenant/shared-databases";
import type { SharedListSource } from "@/components/dashboard/storage/explorer/shared-list-parts";
import { providersOf, sharedRunsOf } from "@/components/dashboard/storage/explorer/shared-runs";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import type { SharedOverview } from "@/services/tenant/shared-databases";
import { SharedDetailsSheet } from "./shared-details";
import { sharedKey, type SharedRow } from "./shared-model";
import { useSharedActions, type SharedAccess } from "./use-shared-actions";

const log = logger.child({ component: "use-shared-backups" });

const FAILED = "The backups shared with you could not be loaded.";

interface Loaded {
    data: SharedOverview | null;
    error: string | null;
}

/**
 * The backups of the databases another tenant's server gives to this one, for the list of the
 * Backups page beside the own backups: loads them while `enabled`, and holds what a shared backup
 * can do and its panel. A tenant without shared databases asks for nothing.
 */
export function useSharedBackups({ enabled, ...access }: SharedAccess & { enabled: boolean }) {
    const [loaded, setLoaded] = useState<Loaded | null>(null);
    const [version, setVersion] = useState(0);
    const [reloading, setReloading] = useState(false);
    const [details, setDetails] = useState<{ open: boolean; id: string } | null>(null);
    const onClosedRef = useRef<(() => void) | null>(null);

    useEffect(() => {
        if (!enabled) return;
        let ignore = false;
        getSharedOverview()
            .then((result) => {
                if (!ignore) setLoaded((previous) => (result.success ? { data: result.data, error: null } : { data: previous?.data ?? null, error: result.error }));
            })
            .catch((error: unknown) => {
                if (ignore) return;
                log.warn("Loading the shared backups failed", {}, wrapError(error));
                setLoaded((previous) => ({ data: previous?.data ?? null, error: FAILED }));
            })
            .finally(() => {
                if (!ignore) setReloading(false);
            });
        return () => {
            ignore = true;
        };
    }, [enabled, version]);

    const reload = useCallback(() => {
        if (!enabled) return;
        setReloading(true);
        setVersion((value) => value + 1);
    }, [enabled]);

    const data = loaded?.data ?? null;
    const databases = useMemo(() => data?.databases ?? [], [data]);
    const runs = useMemo(() => sharedRunsOf(data), [data]);
    const actions = useSharedActions({ ...access, databases, onChanged: reload });

    const open = useCallback((row: SharedRow, onClosed?: () => void) => {
        onClosedRef.current = onClosed ?? null;
        setDetails({ open: true, id: row.id });
    }, []);
    const reset = useCallback(() => {
        onClosedRef.current = null;
        setDetails(null);
    }, []);
    // Once the panel is gone, the one who opened it takes the focus, like the details of an own backup.
    const closed = useCallback((event: Event) => {
        const onClosed = onClosedRef.current;
        onClosedRef.current = null;
        if (!onClosed) return;
        event.preventDefault();
        onClosed();
    }, []);

    // What the list of every backup needs of them, left out once they loaded without a single
    // database, like for a tenant without any.
    const { groupsFor, footFor } = actions;
    const error = loaded?.error ?? null;
    const activeId = details?.open ? details.id : null;
    const source = useMemo<SharedListSource | null>(() => (enabled && (loaded === null || error !== null || databases.length > 0)
        ? { databases, providers: providersOf(databases), loading: loaded === null, error, onRetry: reload, groupsFor, footFor, activeId }
        : null), [enabled, loaded, error, databases, reload, groupsFor, footFor, activeId]);

    const picked = details ? runs.find((run) => run.shared.id === details.id)?.shared ?? null : null;
    const elements = enabled ? (
        <>
            <SharedDetailsSheet
                open={details?.open ?? false}
                row={picked}
                onClose={() => setDetails((current) => (current ? { ...current, open: false } : null))}
                onCloseAutoFocus={closed}
                onDownload={picked && actions.download ? () => void actions.download?.(picked) : undefined}
                onRestore={picked ? actions.askRestore(picked) : undefined}
                downloading={picked !== null && actions.downloading === picked.id}
                onBackUp={picked && actions.backups.offered(picked.database) ? () => void actions.backups.backUp(picked.database) : undefined}
                backUpReady={picked !== null && actions.backups.ready(picked.database)}
                backingUp={picked !== null && actions.backups.starting === sharedKey(picked.database)}
            />
            {actions.dialogs}
        </>
    ) : null;

    return {
        /** The first load is on its way. */
        loading: enabled && loaded === null,
        error,
        runs,
        /** What the list of every backup needs of them, null for a tenant without shared databases. */
        source,
        reload,
        reloading,
        open,
        reset,
        /** The panel and the dialogs, mounted once by the page. */
        elements,
    };
}

export type SharedBackups = ReturnType<typeof useSharedBackups>;
