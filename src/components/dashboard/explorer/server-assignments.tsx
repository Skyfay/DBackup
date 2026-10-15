"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { assignDatabases, getSourceAssignments } from "@/app/actions/tenant/database-assignments";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useDateFormatter } from "@/hooks/use-date-formatter";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import type { SourceAssignments } from "@/services/tenant/database-assignments";
import { changeText, countOf } from "./assignment-model";
import type { OwnerChange } from "./assignment-picker";
import { AssignmentRules } from "./assignment-rules";
import { AssignmentTable } from "./assignment-table";
import { AssignmentTimeline, type HoldPick } from "./assignment-timeline";
import { changesThisYear, holdLines } from "./assignment-timeline-model";

const log = logger.child({ component: "server-assignments" });

const FAILED = "The tenants of the databases could not be loaded.";

interface Loaded {
    serverId: string;
    data: SourceAssignments | null;
    error: string | null;
    /** When the answer came, so the rules of every row are read at the same moment. */
    at: Date;
}

interface ServerAssignmentsProps {
    serverId: string;
    serverName: string;
    /** The tenant of the server, which sees every database of it. */
    tenantName: string;
    /** Whether the viewer may give databases away and change the rules. */
    canAssign: boolean;
}

/** The cards in the shape of the loaded ones, while they load. */
function AssignmentsSkeleton() {
    return (
        <div className="grid items-start gap-4 md:gap-6 @5xl:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]" aria-busy="true">
            <span className="sr-only">Loading who the databases belong to</span>
            {[6, 3].map((rows, card) => (
                <div key={card} className="space-y-3 rounded-xl border bg-card p-5 shadow-sm">
                    <Skeleton className="h-5 w-48" />
                    <Skeleton className="h-3 w-72 max-w-full" />
                    {Array.from({ length: rows }, (_, index) => <Skeleton key={index} className="h-10 w-full" />)}
                </div>
            ))}
        </div>
    );
}

/**
 * Which tenant sees the backups of each database of a shared server, for the tenant that runs it,
 * after the design Shared78-D: the databases with a tenant picker in every row and Give to tenant
 * for several at once, the rules beside them with a preview of what a new one gives, and below a
 * timeline of who held each database when. It fits itself to the room it gets, so the page of a
 * connection shows the same cards one under the other. Shows only while there is another tenant.
 */
export function ServerAssignments({ serverId, serverName, tenantName, canAssign }: ServerAssignmentsProps) {
    const { formatDate } = useDateFormatter();
    const [loaded, setLoaded] = useState<Loaded | null>(null);
    const [version, setVersion] = useState(0);
    const [picked, setPicked] = useState<HoldPick | null>(null);
    const timelineId = `held-${serverId}`;

    useEffect(() => {
        let ignore = false;
        getSourceAssignments(serverId)
            .then((result) => {
                if (!ignore) setLoaded({ serverId, data: result.success ? result.data : null, error: result.success ? null : result.error, at: new Date() });
            })
            .catch((error: unknown) => {
                if (ignore) return;
                log.warn("Loading the assignments failed", { serverId }, wrapError(error));
                setLoaded({ serverId, data: null, error: FAILED, at: new Date() });
            });
        return () => {
            ignore = true;
        };
    }, [serverId, version]);

    const reload = useCallback(() => setVersion((value) => value + 1), []);
    const current = loaded?.serverId === serverId ? loaded : null;
    const data = current?.data ?? null;
    const now = useMemo(() => current?.at ?? new Date(), [current]);
    const lines = useMemo(() => (data ? holdLines(data, now) : []), [data, now]);
    const changes = useMemo(() => changesThisYear(lines, now), [lines, now]);

    const assign = useCallback(async (list: OwnerChange[]): Promise<boolean> => {
        if (!data || list.length === 0) return false;
        try {
            const result = await assignDatabases(serverId, list.map((change) => ({ databaseName: change.databaseName, tenantId: change.tenantId, ...(change.validFrom ? { validFrom: change.validFrom } : {}) })));
            if (!result.success) {
                toast.error(result.error);
                return false;
            }
            const [first] = list;
            const tenant = first.tenantId ? data.customers.find((entry) => entry.id === first.tenantId)?.name ?? null : null;
            const before = data.databases.find((row) => row.name === first.databaseName)?.owner?.tenantName ?? null;
            const description = tenant
                ? (first.validFrom ? `Its backups from ${formatDate(first.validFrom, "Pp")} on show there.` : "Its backups from now on show there.")
                : (before ? `${before} keeps its backups from before.` : undefined);
            toast.success(list.length === 1 ? changeText(first.databaseName, tenant) : `${countOf(list.length, "database")} changed`, { description });
            reload();
            return true;
        } catch (error: unknown) {
            log.warn("Assigning databases failed", { serverId }, wrapError(error));
            toast.error("The database could not be changed.");
            return false;
        }
    }, [data, serverId, formatDate, reload]);

    const showTimeline = useCallback(() => document.getElementById(timelineId)?.scrollIntoView({ behavior: "smooth", block: "start" }), [timelineId]);
    const showHistory = useCallback((name: string) => {
        const line = lines.find((entry) => entry.name === name);
        if (line) setPicked({ name, index: line.segments.length - 1 });
        // After the timeline drew the pick.
        requestAnimationFrame(showTimeline);
    }, [lines, showTimeline]);

    // With no other tenant there is nobody to give a database to, and the cards stay out.
    if (data && data.customers.length === 0) return null;

    return (
        <section aria-label="Shared with tenants" className="@container min-w-0 space-y-4 md:space-y-6">
            {!current ? (
                <AssignmentsSkeleton />
            ) : !data ? (
                <p className="rounded-xl border bg-card px-5 py-5 text-sm text-muted-foreground shadow-sm">
                    {current.error ?? FAILED}{" "}
                    <Button variant="link" className="h-auto p-0" onClick={reload}>Try again</Button>
                </p>
            ) : (
                <>
                    <div className="grid items-start gap-4 md:gap-6 @5xl:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]">
                        <AssignmentTable
                            serverId={serverId}
                            serverName={serverName}
                            tenantName={tenantName}
                            data={data}
                            canAssign={canAssign}
                            now={now}
                            onChange={assign}
                            onHistory={showHistory}
                            onReload={reload}
                        />
                        <AssignmentRules
                            serverId={serverId}
                            serverName={serverName}
                            data={data}
                            canAssign={canAssign}
                            now={now}
                            changes={changes}
                            onShowTimeline={showTimeline}
                            onChanged={reload}
                        />
                    </div>
                    <AssignmentTimeline id={timelineId} data={data} lines={lines} tenantName={tenantName} now={now} picked={picked} onPick={setPicked} />
                </>
            )}
        </section>
    );
}
