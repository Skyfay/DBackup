"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { backUpSharedDatabase, getSharedBackupRun } from "@/app/actions/tenant/shared-databases";
import { useVisibleInterval } from "@/hooks/use-visible-interval";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import type { SharedDatabase } from "@/services/tenant/shared-databases";
import type { SharedRunState } from "@/services/tenant/shared-on-demand";
import { canBackUpNow, isFormer, sharedKey } from "./shared-model";

const log = logger.child({ component: "use-back-up-now" });

/** How often a backup that runs is asked for its state. */
const POLL_MS = 3_000;

const LIVE: ReadonlySet<SharedRunState> = new Set(["queued", "running"]);

interface BackUpNowOptions {
    databases: SharedDatabase[];
    /** Whether the viewer may start one, which Run now of a job allows in their tenant. */
    canBackUp: boolean;
    /** Loads the tab again, once a backup started or ended. */
    onChanged: () => void;
}

/**
 * Back up now of a shared database: starts a backup its provider allows, follows it through the
 * state the provider's run hands out and nothing else of it, and loads the tab again once it ended,
 * so the new backup shows. A backup started before, in another tab or by a colleague, is followed
 * the same way from the state the tab loaded.
 */
export function useBackUpNow({ databases, canBackUp, onChanged }: BackUpNowOptions) {
    const [starting, setStarting] = useState<string | null>(null);
    const [states, setStates] = useState<Record<string, SharedRunState>>({});
    const told = useRef(new Set<string>());

    const runs = useMemo(() => databases.flatMap((database) => {
        const active = database.onDemand?.active;
        return active ? [{ requestId: active.requestId, databaseName: database.databaseName, providerName: database.providerName, state: states[active.requestId] ?? active.state }] : [];
    }), [databases, states]);
    const live = runs.some((run) => LIVE.has(run.state));

    const poll = useCallback(async () => {
        for (const run of runs) {
            if (!LIVE.has(run.state)) continue;
            try {
                const result = await getSharedBackupRun(run.requestId);
                if (!result.success || result.data.state === run.state) continue;
                const state = result.data.state;
                setStates((current) => ({ ...current, [run.requestId]: state }));
                if (LIVE.has(state) || told.current.has(run.requestId)) continue;
                told.current.add(run.requestId);
                if (state === "done") toast.success(`The backup of ${run.databaseName} is done`, { description: "It shows in the list now." });
                else if (state === "failed") toast.error(`The backup of ${run.databaseName} failed`, { description: `${run.providerName} sees why in its History.` });
                else toast.warning(`The backup of ${run.databaseName} did not finish`, { description: "It was cancelled or is gone." });
                onChanged();
            } catch (error: unknown) {
                log.warn("Reading the state of a shared backup failed", { requestId: run.requestId }, wrapError(error));
            }
        }
    }, [runs, onChanged]);
    useVisibleInterval(() => void poll(), POLL_MS, live);

    const backUp = useCallback(async (database: SharedDatabase) => {
        const key = sharedKey(database);
        setStarting(key);
        try {
            const result = await backUpSharedDatabase({ sourceId: database.sourceId, databaseName: database.databaseName });
            if (!result.success) {
                toast.error(result.error);
                return;
            }
            toast.success(`A backup of ${database.databaseName} starts`, { description: `It runs on the server of ${database.providerName} and shows here once it is done.` });
            onChanged();
        } catch (error: unknown) {
            log.warn("Starting a shared backup failed", { sourceId: database.sourceId }, wrapError(error));
            toast.error("The backup could not be started.");
        } finally {
            setStarting(null);
        }
    }, [onChanged]);

    /** Whether Back up now shows for a database: the viewer may, and the provider allows it for a database that is theirs now. */
    const offered = useCallback((database: SharedDatabase) => canBackUp && !isFormer(database) && database.onDemand !== null, [canBackUp]);
    /** Whether it can start right now, with room left today and nothing running. */
    const ready = useCallback((database: SharedDatabase) => offered(database) && starting === null && canBackUpNow(database.onDemand), [offered, starting]);

    return useMemo(() => ({ backUp, offered, ready, starting }), [backUp, offered, ready, starting]);
}
