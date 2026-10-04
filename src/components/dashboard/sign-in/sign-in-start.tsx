"use client";

import { ChevronRight, Plus } from "lucide-react";
import { ProviderTile } from "@/components/oidc/provider-logo";
import { Button } from "@/components/ui/button";
import { DIALOG_FOOTER, DialogHead, dialogNoteClass } from "@/components/ui/confirm-dialog";
import { DialogClose, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { SsoAdapterOption } from "@/services/sso/sso-providers-types";
import { adapterCopy, GENERIC_ADAPTER, NAMED_ADAPTERS } from "./sign-in-adapters";

const CARD = "flex w-full min-w-0 items-center gap-3 rounded-lg border bg-card p-3 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50";

function ChoiceCard({ adapter, className, onPick }: { adapter: SsoAdapterOption; className?: string; onPick: (adapterId: string) => void }) {
    const copy = adapterCopy(adapter.id, adapter.name);
    return (
        <button type="button" onClick={() => onPick(adapter.id)} className={cn(CARD, className)}>
            <ProviderTile adapterId={adapter.id} size="lg" />
            <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{copy.name}</span>
                {copy.needs && <span className="block text-xs text-muted-foreground">{copy.needs}</span>}
            </span>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
    );
}

/**
 * The first of the two steps of New provider: the provider as a card with its logo and what it
 * asks for. Any other OpenID Connect provider comes last, dashed, since it asks for every endpoint.
 */
export function SignInStart({ adapters, onPick }: { adapters: SsoAdapterOption[]; onPick: (adapterId: string) => void }) {
    const known = new Set([...NAMED_ADAPTERS, GENERIC_ADAPTER]);
    const named = [
        ...NAMED_ADAPTERS.flatMap((id) => adapters.filter((adapter) => adapter.id === id)),
        ...adapters.filter((adapter) => !known.has(adapter.id)),
    ];
    const generic = adapters.find((adapter) => adapter.id === GENERIC_ADAPTER);

    return (
        <>
            <DialogHead tone="create" icon={Plus}>
                <DialogTitle className="text-base">New sign-in provider</DialogTitle>
                <DialogDescription className={dialogNoteClass("create")}>Pick the provider, the next step asks for what it needs</DialogDescription>
            </DialogHead>

            <ScrollArea className="min-h-0 flex-1 *:data-[slot=scroll-area-viewport]:max-h-[calc(95dvh-9rem)]">
                <div className="grid gap-2 p-5 sm:grid-cols-2">
                    {named.map((adapter) => <ChoiceCard key={adapter.id} adapter={adapter} onPick={onPick} />)}
                    {generic && <ChoiceCard adapter={generic} onPick={onPick} className="border-dashed sm:col-span-2" />}
                </div>
            </ScrollArea>

            <div className={cn(DIALOG_FOOTER, "flex items-center justify-between gap-3")}>
                <span className="text-xs text-muted-foreground">Step 1 of 2</span>
                <DialogClose asChild>
                    <Button variant="outline" size="sm">Cancel</Button>
                </DialogClose>
            </div>
        </>
    );
}
