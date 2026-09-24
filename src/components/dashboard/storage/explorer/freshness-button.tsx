"use client";

import { useState } from "react";
import { Check, ClockAlert, Loader2, RefreshCw, TriangleAlert } from "lucide-react";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { Button } from "@/components/ui/button";
import { DialogHead, dialogNoteClass } from "@/components/ui/confirm-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DateDisplay } from "@/components/utils/date-display";
import { cn } from "@/lib/utils";
import type { ExplorerDestination } from "@/services/storage/explorer-types";
import { count } from "./explorer-format";
import { DestinationTile, isStale } from "./explorer-cells";

interface FreshnessButtonProps {
    /** The destinations whose lists the page shows. */
    destinations: ExplorerDestination[];
    /** Lists them live, which also brings DBackup's list of each up to date. */
    onCheckNow: () => Promise<void>;
}

/** The oldest of the lists, which is how old the page can be at most. */
function oldestListing(destinations: ExplorerDestination[]): string | null {
    const times = destinations.map((destination) => destination.listedAt).filter((value): value is string => value !== null);
    if (times.length === 0) return null;
    return times.reduce((oldest, time) => (Date.parse(time) < Date.parse(oldest) ? time : oldest));
}

function StateLine({ destination }: { destination: ExplorerDestination }) {
    if (destination.listing) return <>Comparing with the storage now</>;
    if (destination.listError && !destination.listedAt) {
        return <span className="text-destructive">Could not be listed: {destination.listError}</span>;
    }
    if (destination.listError || destination.health.status === "OFFLINE") {
        return (
            <span className="text-warning">
                {destination.listError ? "The last listing failed" : "Not reachable"}
                {destination.listedAt && <> · the list is from <DateDisplay date={destination.listedAt} format="Pp" /></>}
            </span>
        );
    }
    if (!destination.listedAt) return <>Not listed yet</>;
    return (
        <>
            Compared with the storage <RelativeTime date={destination.listedAt} /> · {count(destination.count, "backup")}
        </>
    );
}

/**
 * How old the lists behind the page are. DBackup keeps a list of the files at every destination,
 * changes it with every backup, deletion, lock and check, and compares it with the storage every
 * hour. Check now lists the destinations live.
 */
export function FreshnessButton({ destinations, onCheckNow }: FreshnessButtonProps) {
    const [open, setOpen] = useState(false);
    const [checking, setChecking] = useState(false);
    const oldest = oldestListing(destinations);
    const listing = destinations.filter((destination) => destination.listing);
    const behind = destinations.filter((destination) => !destination.listing && isStale(destination));
    const tone = listing.length > 0 ? "neutral" : behind.length > 0 ? "warning" : "success";
    const busy = checking || listing.length > 0;

    const checkNow = async () => {
        setChecking(true);
        try {
            await onCheckNow();
        } finally {
            setChecking(false);
        }
    };

    if (destinations.length === 0) return null;

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button variant="outline" className="h-9 gap-2 px-3" aria-label="How old the lists are">
                    {busy ? <Loader2 className="animate-spin" /> : <RefreshCw className="text-muted-foreground" />}
                    <span className="hidden sm:inline">
                        {listing.length > 0 ? "Listing" : oldest ? <>Checked <RelativeTime date={oldest} /></> : "Not listed yet"}
                    </span>
                    {!busy && behind.length > 0 && <span className="size-1.5 rounded-full bg-warning" aria-hidden="true" />}
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
                    <ul className="divide-y rounded-lg border">
                        {destinations.map((destination) => (
                            <li key={destination.id} className="flex items-center gap-3 px-3 py-2">
                                <DestinationTile destination={destination} />
                                <div className="min-w-0 flex-1">
                                    <span className="block truncate text-sm font-medium">{destination.name}</span>
                                    <span className="block truncate text-xs text-muted-foreground">
                                        <StateLine destination={destination} />
                                    </span>
                                </div>
                                {destination.listing ? (
                                    <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
                                ) : isStale(destination) ? (
                                    <ClockAlert className="size-4 shrink-0 text-warning" aria-hidden="true" />
                                ) : (
                                    <Check className="size-4 shrink-0 text-success" aria-hidden="true" />
                                )}
                            </li>
                        ))}
                    </ul>
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
