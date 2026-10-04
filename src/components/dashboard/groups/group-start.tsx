"use client";

import { ChevronRight, DatabaseBackup, Eye, Play, Plus, ScrollText, SlidersHorizontal, UserCog, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DIALOG_FOOTER, DialogHead, dialogNoteClass } from "@/components/ui/confirm-dialog";
import { DialogClose, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { GROUP_TEMPLATES, type GroupTemplate } from "@/lib/auth/group-templates";
import { cn } from "@/lib/utils";
import type { GroupRow } from "@/services/user/groups-types";
import { GroupTile, LevelStrip, permissionCount, TOTAL_PERMISSIONS } from "./group-cells";
import { groupLine } from "./group-columns";

/** What a new group starts with, picked in the first step. */
export type GroupStartChoice = { kind: "custom" } | { kind: "template"; template: GroupTemplate } | { kind: "copy"; group: GroupRow };

const TEMPLATE_ICONS: Record<GroupTemplate["id"], LucideIcon> = {
    viewer: Eye,
    operator: Play,
    "backup-admin": DatabaseBackup,
    auditor: ScrollText,
    "user-admin": UserCog,
};

const CARD = "flex w-full min-w-0 gap-3 rounded-lg border bg-card p-3 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50";

function Tile({ icon: Icon }: { icon: LucideIcon }) {
    return (
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-muted/50" aria-hidden="true">
            <Icon className="size-4" />
        </span>
    );
}

/**
 * The first of the two steps of New group: a template for a common kind of work, a copy of a
 * group that exists, or Custom, which starts with nothing. The second step is always the editor.
 */
export function GroupStart({ groups, onPick }: { groups: GroupRow[]; onPick: (choice: GroupStartChoice) => void }) {
    return (
        <>
            <DialogHead tone="create" icon={Plus}>
                <DialogTitle className="text-base">New group</DialogTitle>
                <DialogDescription className={dialogNoteClass("create")}>Pick what it starts with, every permission can change in the next step</DialogDescription>
            </DialogHead>

            <ScrollArea className="min-h-0 flex-1 *:data-[slot=scroll-area-viewport]:max-h-[calc(95dvh-9rem)]">
                <div className="space-y-5 p-5">
                    <button type="button" onClick={() => onPick({ kind: "custom" })} className={cn(CARD, "items-center border-dashed")}>
                        <Tile icon={SlidersHorizontal} />
                        <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium">Custom</span>
                            <span className="block text-xs text-muted-foreground">Starts with no permission, you pick every one yourself</span>
                        </span>
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    </button>

                    <section className="space-y-2">
                        <h3 className="text-xs font-medium text-muted-foreground">Templates</h3>
                        <div className="grid gap-2 sm:grid-cols-2">
                            {GROUP_TEMPLATES.map((template) => (
                                <button key={template.id} type="button" onClick={() => onPick({ kind: "template", template })} className={cn(CARD, "flex-col")}>
                                    <span className="flex items-start gap-3">
                                        <Tile icon={TEMPLATE_ICONS[template.id]} />
                                        <span className="min-w-0 flex-1">
                                            <span className="flex items-baseline gap-2">
                                                <span className="truncate text-sm font-medium">{template.label}</span>
                                                <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
                                                    {template.permissions.length} of {TOTAL_PERMISSIONS}
                                                </span>
                                            </span>
                                            <span className="block text-xs text-muted-foreground">{template.description}</span>
                                        </span>
                                    </span>
                                    <LevelStrip permissions={template.permissions} />
                                </button>
                            ))}
                        </div>
                    </section>

                    {groups.length > 0 && (
                        <section className="space-y-2">
                            <h3 className="text-xs font-medium text-muted-foreground">Copy a group</h3>
                            <div className="space-y-1">
                                {groups.map((group) => (
                                    <button key={group.id} type="button" onClick={() => onPick({ kind: "copy", group })} className={cn(CARD, "items-center border-transparent px-2 py-2")}>
                                        <GroupTile group={group} />
                                        <span className="min-w-0 flex-1">
                                            <span className="block truncate text-sm font-medium">{group.name}</span>
                                            <span className="block truncate text-xs text-muted-foreground">{groupLine(group)}</span>
                                        </span>
                                        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                                            {permissionCount(group)} of {TOTAL_PERMISSIONS}
                                        </span>
                                        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                                    </button>
                                ))}
                            </div>
                        </section>
                    )}
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
