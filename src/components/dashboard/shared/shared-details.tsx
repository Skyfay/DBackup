"use client";

import { ArrowRightLeft, Download, Info, Loader2, Lock, Play, RotateCcw, ShieldCheck } from "lucide-react";
import { AdapterIcon } from "@/components/adapter/adapter-icon";
import { kindNames } from "@/components/adapter/connection-columns";
import { FactList, Section } from "@/components/adapter/connection-details-sections";
import { IntegrityBadge } from "@/components/dashboard/storage/explorer/explorer-cells";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { DateDisplay } from "@/components/utils/date-display";
import { formatBytes } from "@/lib/utils";
import { checkOf, FormerTag, ProviderChip } from "./shared-cells";
import { formerLabel, isFormer, madeAt, madeAtText, onDemandLine, starterOf, type SharedRow } from "./shared-model";

interface SharedDetailsProps {
    row: SharedRow;
    /** Left out for a viewer who may not download. */
    onDownload?: () => void;
    /** Left out for a viewer who may not restore and for a database that is no longer theirs. */
    onRestore?: () => void;
    downloading: boolean;
    /** Back up now, left out where the provider allows none or the viewer may not start one. */
    onBackUp?: () => void;
    /** Whether a backup can start right now: room left today and none running. */
    backUpReady: boolean;
    backingUp: boolean;
}

function Note({ icon: Icon, children }: { icon: typeof Info; children: React.ReactNode }) {
    return (
        <p className="flex gap-2.5 rounded-lg border bg-muted/30 px-3 py-2.5 text-sm">
            <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span>{children}</span>
        </p>
    );
}

/** Everything about one shared backup: where it comes from, the backup itself and what it can do. */
function SharedDetails({ row, onDownload, onRestore, downloading, onBackUp, backUpReady, backingUp }: SharedDetailsProps) {
    const { database } = row;
    const former = isFormer(database);
    const made = madeAt(row);
    const kind = kindNames.get(database.adapterId) ?? database.adapterId;
    const size = row.dump
        ? `${formatBytes(row.dump.stored, 1)}${row.dump.unpacked > row.dump.stored ? `, ${formatBytes(row.dump.unpacked, 1)} unpacked` : ""}`
        : "Not read yet";
    const starter = starterOf(row);

    return (
        <>
            <SheetHeader className="gap-4 border-b p-5 pr-12">
                <div className="flex min-w-0 items-start gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-muted/50" aria-hidden="true">
                        <AdapterIcon adapterId={database.adapterId} className="size-5" />
                    </span>
                    <div className="min-w-0">
                        <SheetTitle className="flex min-w-0 items-center gap-2 text-lg font-semibold">
                            <span className="truncate">{database.databaseName}</span>
                            {former && <FormerTag label={formerLabel(database)} />}
                        </SheetTitle>
                        <SheetDescription className="truncate text-sm text-muted-foreground tabular-nums">
                            <DateDisplay date={row.createdAt} format="PPp" />
                            {row.dump && <> · {formatBytes(row.dump.stored, 1)}</>}
                        </SheetDescription>
                    </div>
                </div>
                {(onDownload || onRestore || onBackUp) && (
                    <div className="flex flex-wrap items-center gap-2">
                        {onDownload && (
                            <Button variant="outline" size="sm" onClick={onDownload} disabled={downloading}>
                                {downloading ? <Loader2 className="animate-spin" /> : <Download />}
                                {downloading ? "Preparing" : "Download"}
                            </Button>
                        )}
                        {onRestore && (
                            <Button variant="outline" size="sm" onClick={onRestore}>
                                <RotateCcw />
                                Restore into {database.databaseName}
                            </Button>
                        )}
                        {onBackUp && (
                            <Button variant="outline" size="sm" onClick={onBackUp} disabled={!backUpReady}>
                                {backingUp ? <Loader2 className="animate-spin" /> : <Play />}
                                Back up now
                            </Button>
                        )}
                        {onBackUp && database.onDemand && <span className="text-xs text-muted-foreground">{onDemandLine(database.onDemand)}</span>}
                    </div>
                )}
            </SheetHeader>

            <ScrollArea className="min-h-0 flex-1">
                <div className="space-y-6 p-5">
                    <Section title="Where it comes from">
                        <FactList
                            columns={1}
                            facts={[
                                { label: "Database", value: database.databaseName },
                                { label: "Server", value: `${database.serverName} · ${kind}${database.serverGone ? " · deleted" : ""}` },
                                ...(made ? [{ label: "This backup", value: madeAtText(made, database.databaseName) }] : []),
                                ...(database.movedFrom.length > 0
                                    ? [{
                                        label: "Moved from",
                                        value: (
                                            <span className="grid justify-items-end gap-0.5">
                                                {database.movedFrom.map((place) => (
                                                    <span key={`${place.sourceId}/${place.databaseName}`}>
                                                        {place.databaseName} on {place.serverName}{place.until && <>, until <DateDisplay date={place.until} format="P" /></>}
                                                    </span>
                                                ))}
                                            </span>
                                        ),
                                    }]
                                    : []),
                                { label: "Provided by", value: <ProviderChip name={database.providerName} /> },
                                database.until
                                    ? { label: "Yours", value: <><DateDisplay date={database.since} format="P" /> to <DateDisplay date={database.until} format="P" /></> }
                                    : { label: "Yours since", value: <DateDisplay date={database.since} format="P" /> },
                            ]}
                        />
                    </Section>

                    <Section title="The backup">
                        <FactList
                            columns={1}
                            facts={[
                                { label: "Made", value: <DateDisplay date={row.createdAt} format="Pp" /> },
                                { label: "Started by", value: `${starter.label} · ${starter.who}` },
                                { label: "Size", value: size },
                                { label: "Encryption", value: row.encrypted ? "Encrypted" : "Not encrypted" },
                                {
                                    label: "Checked",
                                    value: row.verification
                                        ? <span className="inline-flex items-center gap-2"><IntegrityBadge verification={checkOf(row)} /><DateDisplay date={row.verification.at} format="Pp" className="text-xs text-muted-foreground" /></span>
                                        : <IntegrityBadge verification={undefined} />,
                                },
                            ]}
                        />
                    </Section>

                    <Section title="What you can do with it">
                        <div className="space-y-2">
                            <Note icon={Download}>Download hands out the dump of {row.databaseName} alone, unpacked and decrypted.</Note>
                            {database.serverGone ? (
                                <Note icon={Lock}>The server of {database.databaseName} was deleted, so this backup does not restore. Download its dump to restore it somewhere else.</Note>
                            ) : former ? (
                                <Note icon={Lock}>{database.databaseName} is no longer yours, so this backup does not restore. Download its dump to restore it somewhere else.</Note>
                            ) : (
                                <Note icon={Lock}>Restore puts it back into {database.databaseName} on {database.serverName}. Another target needs the download.</Note>
                            )}
                            {made && !former && <Note icon={ArrowRightLeft}>The database moved since this backup was made, so it restores into {database.databaseName} at its new place.</Note>}
                            {onBackUp && <Note icon={Play}>Back up now starts a backup of {database.databaseName} on the server of {database.providerName}, {database.onDemand?.perDay ?? 0} a day at most. It shows here once it is done.</Note>}
                            {row.verification?.passed && <Note icon={ShieldCheck}>{database.providerName} checked this backup after it was made.</Note>}
                        </div>
                    </Section>
                </div>
            </ScrollArea>
        </>
    );
}

interface SharedDetailsSheetProps extends Omit<SharedDetailsProps, "row"> {
    open: boolean;
    /** Stays set while the panel slides out, so its content does not vanish halfway. */
    row: SharedRow | null;
    onClose: () => void;
    /** Once the panel is gone, like the timeline, which opens its list again. */
    onCloseAutoFocus?: (event: Event) => void;
}

/** The details of one shared backup in a panel from the right, like the details of an own backup. */
export function SharedDetailsSheet({ open, row, onClose, onCloseAutoFocus, ...props }: SharedDetailsSheetProps) {
    return (
        <Sheet open={open && row !== null} onOpenChange={(next) => !next && onClose()}>
            <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-xl" onCloseAutoFocus={onCloseAutoFocus}>
                {row && <SharedDetails row={row} {...props} />}
            </SheetContent>
        </Sheet>
    );
}
