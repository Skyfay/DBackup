"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SortingState } from "@tanstack/react-table";
import { Archive, Building2, Clock, DatabaseZap, Info, Layers } from "lucide-react";
import { getSharedOverview } from "@/app/actions/tenant/shared-databases";
import { BackupContextMenu, BackupRowMenu } from "@/components/dashboard/storage/explorer/backup-menus";
import { ExplorerEmpty, ExplorerSkeleton } from "@/components/dashboard/storage/explorer/explorer-page-states";
import { ExplorerStrip } from "@/components/dashboard/storage/explorer/explorer-strip";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { AdapterIcon } from "@/components/adapter/adapter-icon";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import type { ColumnLayoutOption } from "@/components/ui/use-column-layout";
import { listView, type ViewMode } from "@/lib/core/table-preferences";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { formatBytes } from "@/lib/utils";
import type { SharedOverview } from "@/services/tenant/shared-databases";
import { SharedCard } from "./shared-card";
import { SHARED_SEARCH, sharedColumns, sharedFilters } from "./shared-columns";
import { SharedDetailsSheet } from "./shared-details";
import { countOf, rowsOf, sharedKey, summarize, type SharedRow } from "./shared-model";
import { SharedTimeline } from "./shared-timeline";
import { timelineDatabases } from "./shared-timeline-model";
import { useSharedActions, type SharedAccess } from "./use-shared-actions";

const log = logger.child({ component: "shared-tab" });

const FAILED = "The shared databases could not be loaded.";

interface Loaded {
    data: SharedOverview | null;
    error: string | null;
}

interface SharedTabProps extends SharedAccess {
    /** Table or timeline, or the cards a phone always gets. */
    view: ViewMode;
    columnLayout: ColumnLayoutOption;
}

/** Who runs the server and the backups, under the toolbar of the list. */
function ProvidedNote({ providers }: { providers: string[] }) {
    return (
        <p className="flex items-start gap-1.5 px-4 pb-3 text-xs text-muted-foreground">
            <Info className="mt-px size-3.5 shrink-0" aria-hidden="true" />
            {providers.join(", ")} {providers.length === 1 ? "backs" : "back"} these databases up for you. A restore goes back into the same database and changes nothing else on the server.
        </p>
    );
}

/**
 * The tab Shared with you of the Backups page: every backup of the databases another tenant's
 * server gives to this one, in the look of the Backups tab. The numbers on top, the same table
 * with the timeline as its second view, cards on a phone, and the panel of a backup on a click.
 * A backup downloads the dump of its database alone and restores into the same database, and
 * where the provider allows it Back up now starts a new one.
 */
export function SharedTab({ view, columnLayout, ...access }: SharedTabProps) {
    const [loaded, setLoaded] = useState<Loaded | null>(null);
    const [version, setVersion] = useState(0);
    const [reloading, setReloading] = useState(false);
    const [sorting, setSorting] = useState<SortingState>([{ id: "backup", desc: true }]);
    const [details, setDetails] = useState<{ open: boolean; id: string } | null>(null);

    useEffect(() => {
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
    }, [version]);

    const reload = useCallback(() => {
        setReloading(true);
        setVersion((value) => value + 1);
    }, []);

    const data = loaded?.data ?? null;
    const databases = useMemo(() => data?.databases ?? [], [data]);
    const rows = useMemo(() => (data ? rowsOf(data) : []), [data]);
    const summary = useMemo(() => summarize(rows, databases), [rows, databases]);
    const actions = useSharedActions({ ...access, databases, onChanged: reload });
    const { groupsFor } = actions;

    const open = useCallback((row: SharedRow) => setDetails({ open: true, id: row.id }), []);
    const renderActions = useCallback((row: SharedRow) => <BackupRowMenu name={row.database.databaseName} groups={groupsFor(row)} />, [groupsFor]);
    const columns = useMemo(() => sharedColumns({ onOpen: open, renderActions }), [open, renderActions]);
    const filters = useMemo(() => sharedFilters(databases), [databases]);
    const picked = details ? rows.find((row) => row.id === details.id) ?? null : null;

    if (!loaded) return <ExplorerSkeleton joined />;
    if (!data) {
        return (
            <ExplorerEmpty joined title="The shared databases could not be loaded">
                {loaded.error ?? FAILED}{" "}
                <Button variant="link" className="h-auto p-0" onClick={reload}>Try again</Button>
            </ExplorerEmpty>
        );
    }
    if (databases.length === 0) {
        return <ExplorerEmpty joined title="Nothing is shared with you right now">A database another tenant&apos;s server gives to this one shows here with its backups.</ExplorerEmpty>;
    }

    const [dumpValue, dumpUnit] = summary.newestDumps !== null ? formatBytes(summary.newestDumps, 1).split(" ") : ["-", undefined];
    const timeline = view === "timeline";

    return (
        <div className="space-y-4 md:space-y-0">
            <ExplorerStrip
                joined
                cells={[
                    {
                        label: "Shared databases",
                        icon: DatabaseZap,
                        value: summary.current.toLocaleString(),
                        unit: summary.former > 0 ? `+${summary.former.toLocaleString()} former` : undefined,
                        extra: `on ${countOf(summary.servers, "server")}${summary.former > 0 ? `, the former ones to download only` : ""}`,
                    },
                    { label: "Backups from your time", icon: Archive, value: summary.backups.toLocaleString(), extra: "Only the backups made while a database was yours" },
                    {
                        label: "Newest dumps together",
                        icon: Layers,
                        value: dumpValue,
                        unit: dumpUnit,
                        extra: summary.sizesMissing ? "Some sizes are not read yet, they come in with the next look" : "The newest dump of each database that is yours now",
                    },
                    {
                        label: "Last backup",
                        icon: Clock,
                        value: summary.newest ? <RelativeTime date={summary.newest.createdAt} /> : "-",
                        tone: summary.failed > 0 ? "destructive" : undefined,
                        extra: summary.failed > 0 ? `${countOf(summary.failed, "backup")} failed its check` : summary.newest?.verification?.passed ? "verified" : undefined,
                    },
                    { label: "Runs the server and the backups", icon: Building2, value: summary.providers.join(", ") || "-" },
                ]}
            />

            <DataTable
                joined
                columns={columns}
                data={rows}
                searchKey={SHARED_SEARCH}
                searchPlaceholder="Search shared databases"
                filterableColumns={filters}
                toolbarNote={<ProvidedNote providers={summary.providers} />}
                aboveRows={timeline
                    ? (filtered) => {
                        const shown = filtered.map((row) => row.original);
                        return <SharedTimeline rows={shown} databases={timelineDatabases(databases, shown, shown.length < rows.length)} onOpen={open} />;
                    }
                    : undefined}
                hideRows={timeline}
                sorting={sorting}
                onSortingChange={setSorting}
                onRefresh={reload}
                isLoading={reloading}
                getRowId={(row) => row.id}
                columnLayout={columnLayout}
                onRowClick={open}
                activeRowId={details?.open ? details.id : null}
                view={listView(view)}
                renderCard={(row) => <SharedCard row={row.original} onOpen={open} actions={renderActions(row.original)} />}
                renderRowMenu={(row, bulk) => (
                    <BackupContextMenu
                        tile={<span className="flex size-8 items-center justify-center rounded-lg border bg-muted/50"><AdapterIcon adapterId={row.database.adapterId} className="size-4" /></span>}
                        title={row.database.databaseName}
                        note={`${row.database.serverName} · provided by ${row.database.providerName}`}
                        groups={groupsFor(row)}
                        bulk={bulk}
                    />
                )}
            />

            <SharedDetailsSheet
                open={details?.open ?? false}
                row={picked}
                onClose={() => setDetails((current) => (current ? { ...current, open: false } : null))}
                onDownload={picked && actions.download ? () => void actions.download?.(picked) : undefined}
                onRestore={picked ? actions.askRestore(picked) : undefined}
                downloading={picked !== null && actions.downloading === picked.id}
                onBackUp={picked && actions.backups.offered(picked.database) ? () => void actions.backups.backUp(picked.database) : undefined}
                backUpReady={picked !== null && actions.backups.ready(picked.database)}
                backingUp={picked !== null && actions.backups.starting === sharedKey(picked.database)}
            />
            {actions.dialogs}
        </div>
    );
}
