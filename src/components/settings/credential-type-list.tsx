"use client";

import { useMemo, useState } from "react";
import { ChevronRight, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DIALOG_FOOTER, DialogHead, dialogNoteClass } from "@/components/ui/confirm-dialog";
import { DialogClose, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { CredentialType } from "@/lib/core/credentials";
import { cn } from "@/lib/utils";
import { CREDENTIAL_TYPE_INFO, CREDENTIAL_TYPE_ORDER, servicesOf } from "./credential-types";

/**
 * The first step of a new profile from the Vault: which kind it is. Every row names the
 * services that log in with the kind, which is how a user knows what to pick, and the search
 * finds a kind by a service as well. Looks and works like the type picker before a connection.
 */
export function CredentialTypeList({ onPick }: { onPick: (type: CredentialType) => void }) {
    const [search, setSearch] = useState("");
    const types = useMemo(() => {
        const term = search.trim().toLowerCase();
        return CREDENTIAL_TYPE_ORDER.map((type) => ({ type, info: CREDENTIAL_TYPE_INFO[type], services: servicesOf(type) })).filter(
            ({ info, services }) => !term || `${info.title} ${info.hint} ${services}`.toLowerCase().includes(term)
        );
    }, [search]);

    return (
        <>
            <DialogHead tone="create" icon={Plus} className="px-5 py-4">
                <DialogTitle className="text-base">New credential profile</DialogTitle>
                <DialogDescription className={dialogNoteClass("create")}>What do you want to save?</DialogDescription>
            </DialogHead>

            <div className="px-5 pt-4">
                <div className="relative">
                    <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                    <Input
                        placeholder="Search by name or service"
                        aria-label="Search by name or service"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        className="pl-8"
                    />
                </div>
            </div>

            {/* Block instead of Radix's `display: table` wrapper, so the long service lines are cut off. */}
            <ScrollArea className="*:data-[slot=scroll-area-viewport]:max-h-[calc(95dvh-12rem)] [&>[data-slot=scroll-area-viewport]>div]:block!">
                <div className="px-5 py-3">
                    {types.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Nothing matches your search.</p>}
                    {types.map(({ type, info, services }) => (
                        <button
                            key={type}
                            type="button"
                            onClick={() => onPick(type)}
                            className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/50"
                        >
                            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-muted/50">
                                <info.icon className="size-4" aria-hidden="true" />
                            </span>
                            <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-medium">{info.title}</span>
                                <span className="block truncate text-xs text-muted-foreground">{services}</span>
                            </span>
                            <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                        </button>
                    ))}
                </div>
            </ScrollArea>

            <div className={cn(DIALOG_FOOTER, "flex items-center justify-between gap-3")}>
                <span className="text-xs text-muted-foreground">Step 1 of 2</span>
                <DialogClose asChild>
                    <Button variant="outline" size="sm">
                        Cancel
                    </Button>
                </DialogClose>
            </div>
        </>
    );
}
