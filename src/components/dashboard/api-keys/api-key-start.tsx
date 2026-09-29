"use client";

import { Activity, ChevronRight, Download, Eye, LayoutDashboard, Lock, Play, Plus, RotateCcw, SlidersHorizontal, type LucideIcon } from "lucide-react";
import { LevelStrip, TOTAL_PERMISSIONS } from "@/components/dashboard/groups/group-cells";
import { Button } from "@/components/ui/button";
import { DIALOG_FOOTER, DialogHead, dialogNoteClass } from "@/components/ui/confirm-dialog";
import { DialogClose, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { listWords } from "@/lib/auth/access-summary";
import { API_KEY_TEMPLATES, type ApiKeyTemplate } from "@/lib/auth/api-key-templates";
import { permissionPhrase } from "@/lib/auth/permission-areas";
import { cn } from "@/lib/utils";
import type { ApiKeyRow } from "@/services/auth/api-keys-types";
import { keyLine, KeyTile } from "./api-key-cells";

/** What a new key starts with, picked in the first step. */
export type ApiKeyStartChoice = { kind: "custom" } | { kind: "template"; template: ApiKeyTemplate } | { kind: "copy"; key: ApiKeyRow };

const TEMPLATE_ICONS: Record<ApiKeyTemplate["id"], LucideIcon> = {
    ci: Play,
    widget: LayoutDashboard,
    monitoring: Activity,
    download: Download,
    restore: RotateCcw,
    read: Eye,
};

const CARD = "flex w-full min-w-0 gap-3 rounded-lg border bg-card p-3 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-card";

function Tile({ icon: Icon }: { icon: LucideIcon }) {
    return (
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-muted/50" aria-hidden="true">
            <Icon className="size-4" />
        </span>
    );
}

/** The permissions of a task the viewer may not hand out, by name. */
function missingOf(permissions: string[], viewer: ReadonlySet<string>): string[] {
    return permissions.filter((permission) => !viewer.has(permission)).map(permissionPhrase);
}

interface ApiKeyStartProps {
    keys: ApiKeyRow[];
    /** What the viewer may do, the most a key of theirs may get. */
    viewerPermissions: readonly string[];
    onPick: (choice: ApiKeyStartChoice) => void;
}

/**
 * The first of the two steps of New API key: a common task of the API with exactly the
 * permissions its calls need, a copy of a key, or Custom, which starts with nothing. A task the
 * group of the viewer does not allow shows why and cannot be picked.
 */
export function ApiKeyStart({ keys, viewerPermissions, onPick }: ApiKeyStartProps) {
    const viewer = new Set(viewerPermissions);
    return (
        <>
            <DialogHead tone="create" icon={Plus}>
                <DialogTitle className="text-base">New API key</DialogTitle>
                <DialogDescription className={dialogNoteClass("create")}>Pick the task it is for, every permission can change in the next step</DialogDescription>
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
                        <h3 className="text-xs font-medium text-muted-foreground">For a task</h3>
                        <div className="grid gap-2 sm:grid-cols-2">
                            {API_KEY_TEMPLATES.map((template) => {
                                const missing = missingOf(template.permissions, viewer);
                                return (
                                    <button
                                        key={template.id}
                                        type="button"
                                        disabled={missing.length > 0}
                                        onClick={() => onPick({ kind: "template", template })}
                                        className={cn(CARD, "flex-col")}
                                    >
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
                                                <span className="mt-1 block truncate font-mono text-[11px] text-muted-foreground">{template.call}</span>
                                                {missing.length > 0 && (
                                                    <span className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                                                        <Lock className="size-3 shrink-0" aria-hidden="true" />
                                                        Your group may not {listWords(missing)}
                                                    </span>
                                                )}
                                            </span>
                                        </span>
                                        <LevelStrip permissions={template.permissions} />
                                    </button>
                                );
                            })}
                        </div>
                    </section>

                    {keys.length > 0 && (
                        <section className="space-y-2">
                            <h3 className="text-xs font-medium text-muted-foreground">Copy a key</h3>
                            <div className="space-y-1">
                                {keys.map((key) => (
                                    <button key={key.id} type="button" onClick={() => onPick({ kind: "copy", key })} className={cn(CARD, "items-center border-transparent px-2 py-2")}>
                                        <KeyTile />
                                        <span className="min-w-0 flex-1">
                                            <span className="block truncate text-sm font-medium">{key.name}</span>
                                            <span className="block truncate text-xs text-muted-foreground">{keyLine(key)}</span>
                                        </span>
                                        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                                            {key.effective.length} of {TOTAL_PERMISSIONS}
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
