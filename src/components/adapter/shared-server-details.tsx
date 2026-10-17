"use client";

import Link from "next/link";
import { Archive, Building2, Database, Info, ListFilter, RotateCcw } from "lucide-react";
import { AdapterIcon } from "@/components/adapter/adapter-icon";
import { describeSchedule } from "@/components/dashboard/jobs/job-schedule";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { DateDisplay } from "@/components/utils/date-display";
import { connectionVersion } from "@/lib/adapters/connection-summary";
import { cn, formatBytes } from "@/lib/utils";
import type { ProvidedDatabase, SharedServerTerms } from "@/services/sharing/shared-server-rows";
import type { SharedDatabase } from "@/services/tenant/shared-databases";
import { kindNames } from "./connection-columns";
import { SheetHeaderOr } from "./connection-details-content";
import { DetailStats, Section, type DetailStat } from "./connection-details-sections";
import { databasesYours } from "./connection-shared-cells";
import { TenantNameChip } from "./connection-sharing-cells";
import { sharedServerBackupsHref, type SharedDatabaseHandlers, type SharedServerAccess } from "./shared-server-actions";
import { SharedServerDatabases } from "./shared-server-databases";
import { DropdownEntries } from "./shared-server-menus";
import type { AdapterConfig } from "./types";

interface SharedServerDetailsProps {
    /** "sheet" titles the panel it sits in, "inline" stands on a card of its own in the split view. */
    variant: "sheet" | "inline";
    config: AdapterConfig;
    terms: SharedServerTerms;
    access: SharedServerAccess;
    /** The key of the database whose Back up now is being started. */
    starting: string | null;
    onBackUp: (database: SharedDatabase) => void;
    handlers: SharedDatabaseHandlers;
}

function Note({ icon: Icon, children }: { icon: typeof Info; children: React.ReactNode }) {
    return (
        <p className="flex gap-2.5 rounded-lg border bg-muted/30 px-3 py-2.5 text-sm">
            <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span>{children}</span>
        </p>
    );
}

/** "acme_shop, then acme_crm": which database became the tenant's first. */
function sinceOrder(databases: readonly ProvidedDatabase[]): string {
    const sorted = [...databases].sort((a, b) => a.database.since.localeCompare(b.database.since)).map(({ database }) => database.databaseName);
    if (sorted.length <= 1) return sorted[0] ?? "";
    return sorted.length === 2 ? `${sorted[0]}, then ${sorted[1]}` : `${sorted[0]} first`;
}

/** The six numbers on top: since when, how it is backed up, its backups, Back up now, the newest dumps and the rest of the server. */
function factsOf(terms: SharedServerTerms): DetailStat[] {
    const { databases, providerName } = terms;
    const since = databases.map(({ database }) => database.since).sort()[0];
    const allowing = databases.filter(({ database }) => database.onDemand);
    const left = allowing.reduce((sum, { database }) => sum + Math.max(0, database.onDemand!.perDay - database.onDemand!.usedToday), 0);
    const perDay = allowing.reduce((sum, { database }) => sum + database.onDemand!.perDay, 0);
    const newest = databases.flatMap(({ newest: backup }) => (backup ? [backup] : []));
    const sized = newest.filter((backup) => backup.dump);
    const verified = newest.filter((backup) => backup.verification?.passed).length;
    const failed = newest.filter((backup) => backup.verification?.passed === false).length;
    const checks = failed > 0
        ? `${failed} failed ${failed === 1 ? "its" : "their"} check`
        : verified === newest.length ? (newest.length === 2 ? "both verified" : newest.length === 1 ? "verified" : "all verified") : `${verified} of ${newest.length} verified`;
    return [
        { label: "Yours since", value: since ? <DateDisplay date={since} format="PP" /> : "-", extra: sinceOrder(databases) },
        { label: "Backed up", value: terms.schedule ? describeSchedule(terms.schedule).text : "No schedule", extra: `by ${providerName}` },
        { label: "Backups", value: terms.backups.toLocaleString(), extra: terms.lastBackup ? <>newest <RelativeTime date={terms.lastBackup.at} /></> : "none yet" },
        allowing.length > 0
            ? { label: "Back up now", value: `${left} of ${perDay}`, extra: allowing.length === 1 ? `${allowing[0].database.databaseName}, left today` : `left today, ${allowing.length} databases` }
            : { label: "Back up now", value: "Off", extra: `${providerName} allows none` },
        { label: "Newest dumps", value: sized.length > 0 ? formatBytes(sized.reduce((sum, backup) => sum + backup.dump!.stored, 0), 1) : "-", extra: newest.length > 0 ? checks : undefined },
        { label: "Other databases", value: "Hidden", extra: "they belong to others" },
    ];
}

/** Restore a database: the newest backup of the one picked, straight away when the tenant has one there. */
function RestoreButton({ terms, onRestore, when }: { terms: SharedServerTerms; onRestore: (entry: ProvidedDatabase) => void; when: (iso: string) => string }) {
    const restorable = terms.databases.filter((entry) => entry.newest);
    if (restorable.length === 0) return null;
    const button = (label: string, onClick?: () => void) => (
        <Button variant="outline" size="sm" tone="warning" onClick={onClick}>
            <RotateCcw className="text-tone" />
            {label}
        </Button>
    );
    if (restorable.length === 1) return button("Restore the newest", () => onRestore(restorable[0]));
    return (
        <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>{button("Restore a database")}</DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
                <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">Its newest backup goes back into it</DropdownMenuLabel>
                <DropdownEntries groups={[{
                    entries: restorable.map((entry) => ({
                        id: entry.database.databaseName,
                        label: entry.database.databaseName,
                        note: when(entry.newest!.createdAt),
                        icon: RotateCcw,
                        onSelect: () => onRestore(entry),
                        tone: "warning",
                    })),
                }]} />
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

/**
 * Everything about a server of another tenant whose databases the tenant holds: who runs it, how
 * its databases are backed up, and each of them with its backups and Back up now. Its address, its
 * settings and its other databases stay with the provider, so there is no edit and no test.
 */
export function SharedServerDetails({ variant, config, terms, access, starting, onBackUp, handlers }: SharedServerDetailsProps) {
    const inSheet = variant === "sheet";
    const Title = inSheet ? SheetTitle : "h2";
    const Description = inSheet ? SheetDescription : "p";
    const version = connectionVersion(config.metadata);
    const provider = terms.providerName;
    const onDemand = terms.databases.some(({ database }) => database.onDemand);

    return (
        <>
            <SheetHeaderOr inSheet={inSheet} className={cn("gap-4 border-b p-5", inSheet && "pr-12")}>
                <div className="flex min-w-0 items-start gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-muted/50">
                        <AdapterIcon adapterId={config.adapterId} className="size-5" />
                    </span>
                    <div className="min-w-0">
                        <Title className="truncate text-lg font-semibold">{terms.serverName}</Title>
                        <Description className="truncate text-sm text-muted-foreground">
                            {kindNames.get(config.adapterId) ?? config.adapterId}
                            {version && ` ${version}`} · provided by {provider} · address hidden
                        </Description>
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <TenantNameChip name={provider} />
                    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Building2 className="size-3.5" aria-hidden="true" />
                        {provider} runs it
                    </span>
                    <span className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-0.5 text-xs font-medium">
                        <Database className="size-3.5 text-muted-foreground" aria-hidden="true" />
                        {databasesYours(terms.databases.length)}
                    </span>
                </div>
                {(access.canViewBackups || access.canRestore) && (
                    <div className="flex flex-wrap items-center gap-2">
                        {access.canViewBackups && (
                            <Button asChild variant="outline" size="sm">
                                <Link href={sharedServerBackupsHref(terms)}>
                                    <Archive />
                                    Show its backups
                                </Link>
                            </Button>
                        )}
                        {access.canRestore && <RestoreButton terms={terms} onRestore={handlers.onRestore} when={handlers.when} />}
                    </div>
                )}
            </SheetHeaderOr>

            <ScrollArea className="min-h-0 flex-1">
                <div className="space-y-6 p-5">
                    {terms.rules.map((rule) => (
                        <Note key={rule.pattern} icon={ListFilter}>
                            {provider} gives you every database named {rule.pattern} on this server, a new one too.{" "}
                            {rule.perDay ? `Each allows ${rule.perDay} ${rule.perDay === 1 ? "backup" : "backups"} a day.` : "Back up now is off for them."}
                        </Note>
                    ))}

                    <DetailStats stats={factsOf(terms)} />

                    <Section title="Your databases on it" aside="each with its own backups">
                        <SharedServerDatabases terms={terms} access={access} starting={starting} onBackUp={onBackUp} handlers={handlers} />
                    </Section>

                    <Note icon={Info}>
                        {onDemand
                            ? `Back up now runs the job of ${provider} for that one database, into an archive of its own. It shows in the Backups tab a minute later, started by you.`
                            : `Your backups of these databases are the ones made while they are yours. ${provider} decides how long they are kept.`}
                    </Note>
                </div>
            </ScrollArea>
        </>
    );
}
