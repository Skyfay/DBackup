"use client";

import { useEffect, useId, useState } from "react";
import { RotateCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";

type Listing = { status: "loading" } | { status: "failed"; message: string } | { status: "loaded"; names: string[] };

const FAILED = "The databases could not be loaded.";

/** From this many databases on, the list gets a filter. */
const FILTER_FROM = 8;

interface DatabaseChecklistProps {
    sourceId: string;
    value: string[];
    onChange: (names: string[]) => void;
}

/** The databases on the server of a source, loaded as soon as the list shows, each with a checkbox. */
export function DatabaseChecklist({ sourceId, value, onChange }: DatabaseChecklistProps) {
    const id = useId();
    const [listing, setListing] = useState<Listing>({ status: "loading" });
    const [attempt, setAttempt] = useState(0);
    const [filter, setFilter] = useState("");

    useEffect(() => {
        let active = true;
        fetch(`/api/adapters/${encodeURIComponent(sourceId)}/databases`)
            .then((res) => res.json())
            .then((body) => {
                if (!active) return;
                setListing(body?.success && Array.isArray(body.databases) ? { status: "loaded", names: body.databases } : { status: "failed", message: body?.error || FAILED });
            })
            .catch(() => active && setListing({ status: "failed", message: FAILED }));
        return () => {
            active = false;
        };
    }, [sourceId, attempt]);

    if (listing.status === "loading") {
        return (
            <div className="grid gap-2 rounded-lg border p-3" aria-busy="true" aria-label="Loading the databases">
                {[0, 1, 2].map((row) => (
                    <Skeleton key={row} className="h-4 w-48" />
                ))}
            </div>
        );
    }

    if (listing.status === "failed") {
        return (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
                <p className="min-w-0 text-sm text-muted-foreground">{listing.message}</p>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                        setListing({ status: "loading" });
                        setAttempt((current) => current + 1);
                    }}
                >
                    <RotateCw />
                    Try again
                </Button>
            </div>
        );
    }

    const { names } = listing;
    if (names.length === 0) {
        return <p className="rounded-lg border px-3 py-2.5 text-sm text-muted-foreground">DBackup sees no databases on this server.</p>;
    }

    const term = filter.trim().toLowerCase();
    const visible = term ? names.filter((name) => name.toLowerCase().includes(term)) : names;
    const toggle = (name: string, on: boolean) => onChange(on ? [...value, name] : value.filter((picked) => picked !== name));

    return (
        <div className="rounded-lg border">
            {names.length >= FILTER_FROM && (
                <div className="relative border-b p-2">
                    <Search className="pointer-events-none absolute top-1/2 left-4.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                    <Input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter databases" aria-label="Filter databases" className="h-8 pl-8" />
                </div>
            )}
            <ScrollArea className="*:data-[slot=scroll-area-viewport]:max-h-48 [&>[data-slot=scroll-area-viewport]>div]:block!">
                <ul className="grid p-1">
                    {visible.map((name) => (
                        <li key={name}>
                            <Label htmlFor={`${id}-${name}`} className="cursor-pointer gap-2.5 rounded-md px-2 py-1.5 font-normal hover:bg-muted/50">
                                <Checkbox id={`${id}-${name}`} checked={value.includes(name)} onCheckedChange={(checked) => toggle(name, checked === true)} />
                                <span className="truncate">{name}</span>
                            </Label>
                        </li>
                    ))}
                    {visible.length === 0 && <li className="px-2 py-3 text-center text-sm text-muted-foreground">No database matches.</li>}
                </ul>
            </ScrollArea>
            <p className="border-t px-3 py-2 text-xs text-muted-foreground tabular-nums">
                {value.length} of {names.length} picked
            </p>
        </div>
    );
}
