"use client";

import { ChevronRight, Plus, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DIALOG_FOOTER, DialogHead, dialogNoteClass } from "@/components/ui/confirm-dialog";
import { DialogClose, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { pickerLine } from "@/lib/auth/platform-group-summary";
import { cn } from "@/lib/utils";
import type { PlatformGroupRow } from "@/services/user/platform-groups-types";
import { PlatformGroupTile } from "./platform-group-cells";

/** What a new platform group starts with, picked in the first step. */
export type PlatformGroupStartChoice = { kind: "custom" } | { kind: "copy"; group: PlatformGroupRow };

const CARD = "flex w-full min-w-0 items-center gap-3 rounded-lg border bg-card p-3 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50";

/**
 * The first of the two steps of New platform group: Custom, which starts with nothing, or a copy of
 * a platform group that exists, Platform admin included. The second step is always the editor.
 */
export function PlatformGroupStart({ groups, onPick }: { groups: PlatformGroupRow[]; onPick: (choice: PlatformGroupStartChoice) => void }) {
    return (
        <>
            <DialogHead tone="create" icon={Plus}>
                <DialogTitle className="text-base">New platform group</DialogTitle>
                <DialogDescription className={dialogNoteClass("create")}>Pick what it starts with, every right can change in the next step</DialogDescription>
            </DialogHead>

            <ScrollArea className="min-h-0 flex-1 *:data-[slot=scroll-area-viewport]:max-h-[calc(95dvh-9rem)]">
                <div className="space-y-5 p-5">
                    <button type="button" onClick={() => onPick({ kind: "custom" })} className={cn(CARD, "border-dashed")}>
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-muted/50" aria-hidden="true">
                            <SlidersHorizontal className="size-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium">Custom</span>
                            <span className="block text-xs text-muted-foreground">Starts with no right and nobody in it, you pick every one yourself</span>
                        </span>
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    </button>

                    <section className="space-y-2">
                        <h3 className="text-xs font-medium text-muted-foreground">Copy a platform group</h3>
                        <div className="space-y-1">
                            {groups.map((group) => (
                                <button key={group.id} type="button" onClick={() => onPick({ kind: "copy", group })} className={cn(CARD, "border-transparent px-2 py-2")}>
                                    <PlatformGroupTile group={group} />
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate text-sm font-medium">{group.name}</span>
                                        <span className="block truncate text-xs text-muted-foreground">{group.builtIn ? "Everything, every tenant" : pickerLine(group)}</span>
                                    </span>
                                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                                </button>
                            ))}
                        </div>
                    </section>
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
