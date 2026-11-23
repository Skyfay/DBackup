"use client";

import { Info, TriangleAlert } from "lucide-react";
import type { SharedRow } from "@/components/dashboard/shared/shared-model";
import { Button } from "@/components/ui/button";
import { QuickFilter } from "@/components/ui/quick-filter";
import { useDateFormatter } from "@/hooks/use-date-formatter";
import type { SharedDatabase } from "@/services/tenant/shared-databases";
import type { BackupActionGroup } from "./backup-actions";
import { BackupContextMenu } from "./backup-menus";
import { SharedTile } from "./shared-run-cells";
import { QUICK_PICKS, type QuickPick, type SharedRun } from "./shared-runs";

/** What the list of every backup needs of the databases another tenant's server gives to this one. */
export interface SharedListSource {
    databases: SharedDatabase[];
    providers: string[];
    /** The first load of the shared backups is on its way. */
    loading: boolean;
    error: string | null;
    onRetry: () => void;
    groupsFor: (row: SharedRow) => BackupActionGroup[];
    footFor: (row: SharedRow) => React.ReactNode;
    /** The shared backup whose panel is open, by its id. */
    activeId: string | null;
}

const QUICK_LABELS: Record<QuickPick, string> = { all: "All", own: "Yours", shared: "Shared with you" };

/** All, Yours and Shared with you with their counts, after the filters of a list that holds shared backups. */
export function BackupQuickFilter({ value, onChange, counts }: { value: QuickPick; onChange: (value: QuickPick) => void; counts: Record<QuickPick, number> }) {
    return (
        <QuickFilter
            aria-label="Filter by whose backups they are"
            value={value}
            onChange={onChange}
            options={QUICK_PICKS.map((option) => ({ value: option, label: QUICK_LABELS[option], count: counts[option] }))}
        />
    );
}

/**
 * What a right click on a shared backup offers: restore into its database, download its dump and
 * back it up now, with what stays with the provider at the foot. A shared backup is never one of a
 * selection, since lock and delete stay with its provider.
 */
export function SharedContextMenu({ run, source }: { run: SharedRun; source: SharedListSource }) {
    const { formatDate } = useDateFormatter();
    const { database } = run.shared;
    return (
        <BackupContextMenu
            tile={<SharedTile adapterId={database.adapterId} size="md" />}
            title={database.databaseName}
            note={`${formatDate(run.createdAt, "Pp")} · from ${database.providerName}`}
            groups={source.groupsFor(run.shared)}
            bulk={null}
            foot={source.footFor(run.shared)}
        />
    );
}

/**
 * Who backs up the databases shared with the tenant, under the toolbar of the list, or why their
 * backups are missing from it.
 */
export function SharedListNote({ providers, error, onRetry }: { providers: string[]; error: string | null; onRetry: () => void }) {
    if (error) {
        return (
            <p className="flex items-start gap-1.5 px-4 pb-3 text-xs text-warning">
                <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
                <span>
                    {error}{" "}
                    <Button variant="link" className="h-auto p-0 text-xs" onClick={onRetry}>Try again</Button>
                </span>
            </p>
        );
    }
    if (providers.length === 0) return null;
    return (
        <p className="flex items-start gap-1.5 px-4 pb-3 text-xs text-muted-foreground">
            <Info className="mt-px size-3.5 shrink-0" aria-hidden="true" />
            {providers.join(", ")} {providers.length === 1 ? "backs" : "back"} up the databases shared with you. Their backups lie in the archive of the provider, you download and restore your database alone.
        </p>
    );
}
