"use client";

import { useId, useState } from "react";
import { ChevronDown, Import, TriangleAlert } from "lucide-react";
import { AdapterIcon } from "@/components/adapter/adapter-icon";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { VaultKeysModel } from "@/services/vault/vault-types";
import { count } from "./vault-format";

/**
 * Backups that name a key the Vault does not have, with the way to bring the key back. Folded to
 * two lines like every banner about problems, the destinations sit behind Show details.
 */
export function MissingKeyBanner({ model, onImport }: { model: VaultKeysModel; onImport?: () => void }) {
    const [expanded, setExpanded] = useState(false);
    const detailsId = useId();
    const { missing } = model.stats;
    if (missing.count === 0) return null;
    const several = missing.destinations.length > 1;
    const where = several ? count(missing.destinations.length, "destination") : missing.destinations[0].name;

    return (
        <div className="relative overflow-hidden rounded-xl border border-warning/30 bg-warning/5 p-4 pl-5 shadow-sm md:pl-6">
            <span className="absolute inset-y-0 left-0 w-1 bg-warning" aria-hidden="true" />
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-warning/12 text-warning" aria-hidden="true">
                        <TriangleAlert className="size-5" />
                    </span>
                    <div className="min-w-0 flex-1 space-y-0.5">
                        <p className="font-semibold leading-snug">
                            {count(missing.count, "backup")} at {where} {missing.count === 1 ? "names" : "name"} a key the Vault does not have
                        </p>
                        <p className="text-sm text-muted-foreground">
                            They were made with a key that was deleted or lives in another install. Import that key from their recovery kit to open them again.
                        </p>
                    </div>
                </div>
                <div className="flex shrink-0 gap-2 sm:ml-auto">
                    {several && (
                        <Button
                            variant="outline"
                            size="sm"
                            className="flex-1 sm:flex-none"
                            onClick={() => setExpanded((open) => !open)}
                            aria-expanded={expanded}
                            aria-controls={detailsId}
                        >
                            {expanded ? "Hide details" : "Show details"}
                            <ChevronDown className={cn("transition-transform", expanded && "rotate-180")} />
                        </Button>
                    )}
                    {onImport && (
                        <Button variant="outline" size="sm" className="flex-1 sm:flex-none" onClick={onImport}>
                            <Import />
                            Import key
                        </Button>
                    )}
                </div>
            </div>
            {several && expanded && (
                // Indented to the text column, the width of the icon plus its gap.
                <ul id={detailsId} className="mt-3 divide-y divide-border/60 border-t border-border/60 sm:ml-12">
                    {missing.destinations.map((destination) => (
                        <li key={destination.id} className="flex min-w-0 items-center gap-2 py-2 text-sm last:pb-0">
                            <AdapterIcon adapterId={destination.adapterId} className="size-4 shrink-0" />
                            <span className="min-w-0 flex-1 truncate">{destination.name}</span>
                            <span className="shrink-0 text-muted-foreground tabular-nums">{count(destination.count, "backup")}</span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
