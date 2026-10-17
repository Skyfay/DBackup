import type * as React from "react";
import { Archive, Download, Eye, Play, RotateCcw } from "lucide-react";
import { canBackUpNow, onDemandLine, sharedKey } from "@/components/dashboard/shared/shared-model";
import { sharedJobKey } from "@/components/dashboard/storage/explorer/shared-runs";
import { SHARED_HREF, sharedBackupsHref } from "@/components/dashboard/storage/explorer/use-explorer-address";
import type { Tone } from "@/components/ui/tone";
import { namesFor } from "@/lib/core/tab-attention";
import type { ProvidedDatabase, SharedServerTerms } from "@/services/sharing/shared-server-rows";
import type { SharedDatabase } from "@/services/tenant/shared-databases";

/**
 * What a server of another tenant offers in its row menu, its right click menu and its panel, as
 * data: Back up now for each of its databases the tenant holds, its details and its backups, and for
 * each database the restore and the download of its newest backup. Its provider runs the server, so
 * edit, test, clone and delete stay with them, and so does the bulk selection. What the viewer may
 * not do is left out, the server checks anyway.
 */

export interface SharedMenuEntry {
    id: string;
    label: string;
    /** The second line of the entry, like how many backups on demand are left today. */
    note?: string;
    icon: React.ComponentType<{ className?: string }>;
    onSelect: () => void;
    disabled?: boolean;
    tone: Tone;
}

/** Entries that belong together, under a heading where they have one. */
export interface SharedMenuGroup {
    label?: string;
    entries: SharedMenuEntry[];
}

/** What the viewer may do, the rights the actions behind the entries check. */
export interface SharedServerAccess {
    /** Back up now, which Run now of a job allows (`jobs:execute`). */
    canBackUp: boolean;
    /** Restore the newest (`storage:restore`). */
    canRestore: boolean;
    /** Show its backups, on the Backups page (`storage:read`). */
    canViewBackups: boolean;
    /** Download the newest (`storage:download`). */
    canDownload: boolean;
}

export interface SharedServerHandlers {
    onBackUp: (database: SharedDatabase) => void;
    onShowDetails: () => void;
    onShowBackups: () => void;
    /** The key of the database whose Back up now is being started, null while none is. */
    starting: string | null;
}

/**
 * Where the Backups page shows the backups of a provided server: of its one database when the
 * tenant has one there, else of every database of it the tenant has, picked in the Job filter.
 */
export function sharedServerBackupsHref(terms: Pick<SharedServerTerms, "databases">): string {
    const databases = terms.databases.map((entry) => entry.database);
    if (databases.length === 1) return sharedBackupsHref(databases[0]);
    return `${SHARED_HREF}${databases.map((database) => `&job=${encodeURIComponent(sharedJobKey(database))}`).join("")}`;
}

/** What is left of Back up now of a database today, or that its provider allows none. */
export function backUpLine(database: Pick<SharedDatabase, "onDemand">, providerName: string): string {
    return database.onDemand ? onDemandLine(database.onDemand) : `${providerName} allows none`;
}

/** Whether Back up now of a database can start right now: its provider allows it, the day has room, none runs or starts. */
export function backUpReady(database: Pick<SharedDatabase, "onDemand">, starting: string | null): boolean {
    return starting === null && database.onDemand !== null && canBackUpNow(database.onDemand);
}

/** The entry of one database in the group Back up now. One its provider allows none of stays, switched off. */
function backUpEntry(entry: ProvidedDatabase, terms: SharedServerTerms, handlers: SharedServerHandlers): SharedMenuEntry {
    const { database } = entry;
    return {
        id: `back-up:${sharedKey(database)}`,
        label: database.databaseName,
        note: backUpLine(database, terms.providerName),
        icon: Play,
        onSelect: () => handlers.onBackUp(database),
        disabled: !backUpReady(database, handlers.starting),
        tone: "neutral",
    };
}

/** The entries of the row of a provided server: Back up now per database, its details and its backups. */
export function sharedServerMenu(terms: SharedServerTerms, access: SharedServerAccess, handlers: SharedServerHandlers): SharedMenuGroup[] {
    const names = terms.databases.map(({ database }) => database.databaseName);
    return [
        ...(access.canBackUp && terms.databases.length > 0 ? [{ label: "Back up now", entries: terms.databases.map((entry) => backUpEntry(entry, terms, handlers)) }] : []),
        {
            entries: [
                { id: "details", label: "Show details", icon: Eye, onSelect: handlers.onShowDetails, tone: "neutral" as const },
                ...(access.canViewBackups
                    ? [{ id: "backups", label: "Show its backups", note: `${terms.backups.toLocaleString()} of ${namesFor(names)}`, icon: Archive, onSelect: handlers.onShowBackups, tone: "neutral" as const }]
                    : []),
            ],
        },
    ];
}

export interface SharedDatabaseHandlers {
    onRestore: (entry: ProvidedDatabase) => void;
    onDownload: (entry: ProvidedDatabase) => void;
    /** A download is being prepared, of this database or another. */
    downloading: boolean;
    /** The time of a backup in the viewer's format. */
    when: (iso: string) => string;
}

/** The menu of one database in the panel: the restore and the download of its newest backup. */
export function sharedDatabaseMenu(entry: ProvidedDatabase, access: SharedServerAccess, handlers: SharedDatabaseHandlers): SharedMenuEntry[] {
    const newest = entry.newest;
    if (!newest) return [];
    const when = handlers.when(newest.createdAt);
    return [
        ...(access.canRestore
            ? [{ id: "restore", label: "Restore the newest", note: `${when} into ${entry.database.databaseName}`, icon: RotateCcw, onSelect: () => handlers.onRestore(entry), tone: "warning" as const }]
            : []),
        ...(access.canDownload
            ? [{ id: "download", label: "Download the newest", note: `The dump of ${when}`, icon: Download, onSelect: () => handlers.onDownload(entry), disabled: handlers.downloading, tone: "neutral" as const }]
            : []),
    ];
}

/** The muted line at the foot of the menu, which says where the rest went. */
export function providerKeepsNote(terms: Pick<SharedServerTerms, "providerName">): string {
    return `${terms.providerName} runs the server. Edit, test and delete stay with them.`;
}
