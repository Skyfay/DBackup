"use client";

import { useState } from "react";
import { Check, ChevronDown, ClockAlert, Loader2, RefreshCw, TriangleAlert } from "lucide-react";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { Button } from "@/components/ui/button";
import { DialogHead, dialogNoteClass } from "@/components/ui/confirm-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DateDisplay } from "@/components/utils/date-display";
import { cn } from "@/lib/utils";
import type { ExplorerDestination } from "@/services/storage/explorer-types";
import { count } from "./explorer-format";
import { DestinationTile, isStale } from "./explorer-cells";

/** From this many destinations on, the list folds them into the ones up to date and the rest. */
const GROUP_FROM = 6;

type Freshness = "listing" | "behind" | "current";

const GROUP_TITLES: Record<Freshness, string> = { listing: "Listing now", behind: "Not up to date", current: "Up to date" };

interface FreshnessButtonProps {
    /** The destinations whose lists the page shows. */
    destinations: ExplorerDestination[];
    /** Lists them live, which also brings DBackup's list of each up to date. */
    onCheckNow: () => Promise<void>;
}

function freshnessOf(destination: ExplorerDestination): Freshness {
    if (destination.listing) return "listing";
    if (isStale(destination) || !destination.listedAt) return "behind";
    return "current";
}

/** The oldest of the lists, which is how old the page can be at most. */
function oldestListing(destinations: ExplorerDestination[]): string | null {
    const times = destinations.map((destination) => destination.listedAt).filter((value): value is string => value !== null);
    if (times.length === 0) return null;
    return times.reduce((oldest, time) => (Date.parse(time) < Date.parse(oldest) ? time : oldest));
}

/** Why a list is not up to date, on the hover of its row. */
function behindReason(destination: ExplorerDestination): string {
    if (destination.listError) return `Listing failed: ${destination.listError}`;
    if (destination.health.status === "OFFLINE") return "Offline, it does not answer the connection check";
    return "Not listed yet";
}

/**
 * When DBackup last compared its list with the storage, the same short line for every
 * destination. One that is behind shows the date, so its age reads without a hover.
 */
function StateLine({ destination, state }: { destination: ExplorerDestination; state: Freshness }) {
    if (state === "listing") return <>Comparing now</>;
    if (!destination.listedAt) return <>Not compared yet</>;
    if (state === "behind") return <>Compared <DateDisplay date={destination.listedAt} format="Pp" /></>;
    return <>Compared <RelativeTime date={destination.listedAt} /></>;
}

function DestinationRow({ destination }: { destination: ExplorerDestination }) {
    const state = freshnessOf(destination);
    const reason = state === "behind" ? behindReason(destination) : undefined;
    return (
        <li className="flex items-center gap-3 px-3 py-2" title={reason}>
            <DestinationTile destination={destination} />
            <div className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{destination.name}</span>
                <span className={cn("block truncate text-xs", state === "behind" ? "text-warning" : "text-muted-foreground")}>
                    <StateLine destination={destination} state={state} />
                </span>
            </div>
            {state === "listing" ? (
                <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
            ) : state === "behind" ? (
                <ClockAlert className="size-4 shrink-0 text-warning" role="img" aria-label={reason} />
            ) : (
                <Check className="size-4 shrink-0 text-success" aria-hidden="true" />
            )}
        </li>
    );
}

function DestinationGroup({ state, destinations, open, onToggle }: {
    state: Freshness;
    destinations: ExplorerDestination[];
    open: boolean;
    onToggle: () => void;
}) {
    return (
        <li>
            <button
                type="button"
                onClick={onToggle}
                aria-expanded={open}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium outline-none hover:bg-muted/50 focus-visible:bg-muted/50"
            >
                <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", !open && "-rotate-90")} aria-hidden="true" />
                <span className="flex-1">{GROUP_TITLES[state]}</span>
                {state === "behind" && <ClockAlert className="size-3.5 shrink-0 text-warning" aria-hidden="true" />}
                <span className="text-xs font-normal text-muted-foreground tabular-nums">{destinations.length}</span>
            </button>
            {open && (
                <ul className="divide-y border-t">
                    {destinations.map((destination) => <DestinationRow key={destination.id} destination={destination} />)}
                </ul>
            )}
        </li>
    );
}

/**
 * How old the lists behind the page are. DBackup keeps a list of the files at every destination,
 * changes it with every backup, deletion, lock and check, and compares it with the storage every
 * hour. Check now lists the destinations live. With many destinations the list folds them into
 * the ones up to date and the rest, and the button counts them instead of naming the oldest.
 */
export function FreshnessButton({ destinations, onCheckNow }: FreshnessButtonProps) {
    const [open, setOpen] = useState(false);
    const [checking, setChecking] = useState(false);
    // The ones that need a look start open, the ones up to date folded.
    const [openGroups, setOpenGroups] = useState<Record<Freshness, boolean>>({ listing: true, behind: true, current: false });
    const oldest = oldestListing(destinations);
    const listing = destinations.filter((destination) => destination.listing);
    const behind = destinations.filter((destination) => !destination.listing && isStale(destination));
    const byState: Record<Freshness, ExplorerDestination[]> = { listing: [], behind: [], current: [] };
    for (const destination of destinations) byState[freshnessOf(destination)].push(destination);
    const tone = listing.length > 0 ? "neutral" : behind.length > 0 ? "warning" : "success";
    const busy = checking || listing.length > 0;
    const grouped = destinations.length >= GROUP_FROM;

    const checkNow = async () => {
        setChecking(true);
        try {
            await onCheckNow();
        } finally {
            setChecking(false);
        }
    };

    if (destinations.length === 0) return null;

    // The oldest list only speaks for all of them when they are all up to date, or when there is one.
    const label = listing.length > 0
        ? "Listing"
        : byState.behind.length > 0 && destinations.length > 1
            ? `${byState.current.length} of ${destinations.length} up to date`
            : oldest ? <>Compared <RelativeTime date={oldest} /></> : "Not compared yet";

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button variant="outline" className="h-9 gap-2 px-3" aria-label="How old the lists are">
                    {busy ? <Loader2 className="animate-spin" /> : <RefreshCw className="text-muted-foreground" />}
                    <span className="hidden sm:inline">{label}</span>
                    {!busy && byState.behind.length > 0 && <span className="size-1.5 rounded-full bg-warning" aria-hidden="true" />}
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-96 overflow-hidden rounded-xl bg-raised p-0" align="end">
                <DialogHead tone={tone} icon={listing.length > 0 ? RefreshCw : behind.length > 0 ? TriangleAlert : Check} className="px-4 py-3">
                    <p className="text-sm font-semibold">
                        {listing.length > 0
                            ? `Comparing ${count(listing.length, "destination")} with the storage`
                            : behind.length > 0 ? `${count(behind.length, "destination")} did not answer` : "The lists are up to date"}
                    </p>
                    <p className={cn(dialogNoteClass(tone), "truncate")}>
                        {listing.length > 0
                            ? "Their backups show up here as soon as they are in"
                            : behind.length > 0 ? "Their backups show as they were at the last list" : "Compared with the storage every hour"}
                    </p>
                </DialogHead>
                <div className="space-y-3 px-4 py-3">
                    <p className="text-xs leading-relaxed text-muted-foreground">
                        DBackup keeps a list of the files at every destination. Its own backups, deletions and checks change it at once,
                        and every hour it is compared with the storage.
                    </p>
                    <ScrollArea className="*:data-[slot=scroll-area-viewport]:max-h-[min(26rem,50vh)]">
                        <ul className="divide-y overflow-hidden rounded-lg border">
                            {grouped
                                ? (["listing", "behind", "current"] as const).filter((state) => byState[state].length > 0).map((state) => (
                                    <DestinationGroup
                                        key={state}
                                        state={state}
                                        destinations={byState[state]}
                                        open={openGroups[state]}
                                        onToggle={() => setOpenGroups((current) => ({ ...current, [state]: !current[state] }))}
                                    />
                                ))
                                : destinations.map((destination) => <DestinationRow key={destination.id} destination={destination} />)}
                        </ul>
                    </ScrollArea>
                </div>
                <div className="flex min-h-10 items-center justify-between gap-3 border-t bg-page/60 px-4 py-1.5">
                    <span className="text-xs text-muted-foreground">
                        {destinations.length === 1 ? "Reads the destination in the background" : `Reads the ${destinations.length} destinations in the background`}
                    </span>
                    <Button variant="outline" size="sm" className="h-7" onClick={() => void checkNow()} disabled={busy}>
                        {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                        Check now
                    </Button>
                </div>
            </PopoverContent>
        </Popover>
    );
}
