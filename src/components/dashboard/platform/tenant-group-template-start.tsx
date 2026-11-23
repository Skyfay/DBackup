"use client";

import { ChevronRight, Plus, SlidersHorizontal } from "lucide-react";
import { CARD, TEMPLATE_ICONS, Tile } from "@/components/dashboard/groups/group-start";
import { GroupTile, LevelStrip, TOTAL_PERMISSIONS } from "@/components/dashboard/groups/group-cells";
import { groupLine } from "@/components/dashboard/groups/group-columns";
import { Button } from "@/components/ui/button";
import { DIALOG_FOOTER, DialogHead, dialogNoteClass } from "@/components/ui/confirm-dialog";
import { DialogClose, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TENANT_GROUP_TEMPLATES } from "@/lib/auth/group-templates";
import { cn } from "@/lib/utils";
import type { TenantGroupTemplateRow } from "@/services/user/groups-types";
import { presetRights, reachLabel, type TenantGroupStart } from "./tenant-group-template-model";

/**
 * The first of the two steps of New group for tenants: a preset for the common uses of a tenant,
 * the customer of a hosting company first, a copy of a group for tenants that exists, or Custom.
 * The second step is the editor, which also picks the tenants.
 */
export function TenantGroupTemplateStart({ templates, onPick }: { templates: readonly TenantGroupTemplateRow[]; onPick: (choice: TenantGroupStart) => void }) {
    return (
        <>
            <DialogHead tone="create" icon={Plus}>
                <DialogTitle className="text-base">New group for tenants</DialogTitle>
                <DialogDescription className={dialogNoteClass("create")}>Pick what it starts with, the permissions and the tenants change in the next step</DialogDescription>
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
                        <h3 className="text-xs font-medium text-muted-foreground">For common uses of a tenant</h3>
                        <div className="grid gap-2 sm:grid-cols-2">
                            {TENANT_GROUP_TEMPLATES.map((template) => {
                                const rights = presetRights(template);
                                return (
                                    <button key={template.id} type="button" onClick={() => onPick({ kind: "template", template })} className={cn(CARD, "flex-col")}>
                                        <span className="flex items-start gap-3">
                                            <Tile icon={TEMPLATE_ICONS[template.id]} />
                                            <span className="min-w-0 flex-1">
                                                <span className="flex items-baseline gap-2">
                                                    <span className="truncate text-sm font-medium">{template.label}</span>
                                                    {template.id === "client" && (
                                                        <span className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">For customers</span>
                                                    )}
                                                    <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">{rights.length} of {TOTAL_PERMISSIONS}</span>
                                                </span>
                                                <span className="block text-xs text-muted-foreground">{template.description}</span>
                                            </span>
                                        </span>
                                        <LevelStrip permissions={rights} />
                                    </button>
                                );
                            })}
                        </div>
                    </section>

                    {templates.length > 0 && (
                        <section className="space-y-2">
                            <h3 className="text-xs font-medium text-muted-foreground">Copy a group for tenants</h3>
                            <div className="space-y-1">
                                {templates.map((template) => (
                                    <button key={template.id} type="button" onClick={() => onPick({ kind: "copy", template })} className={cn(CARD, "items-center border-transparent px-2 py-2")}>
                                        <GroupTile group={{ superAdmin: false }} />
                                        <span className="min-w-0 flex-1">
                                            <span className="block truncate text-sm font-medium">{template.name}</span>
                                            <span className="block truncate text-xs text-muted-foreground">{groupLine({ permissions: template.permissions, superAdmin: false })} · {reachLabel(template)}</span>
                                        </span>
                                        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{template.permissions.length} of {TOTAL_PERMISSIONS}</span>
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
