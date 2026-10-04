"use client";

import { ChevronsUpDown, CircleCheck, CircleX, Copy, Funnel, Lock, Pencil, Play, Plus, Trash2, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DialogHead, dialogNoteClass } from "@/components/ui/confirm-dialog";
import { toneAttribute, type Tone } from "@/components/ui/tone";
import { cn } from "@/lib/utils";

/** A menu entry the way a row menu draws it, its icon in the color of the dialog it opens. */
function Entry({ icon: Icon, label, tone }: { icon: React.ComponentType<{ className?: string }>; label: string; tone: Tone }) {
    return (
        <div {...toneAttribute(tone)} className="flex h-8 items-center gap-2 rounded-md px-2 text-sm">
            <Icon className={cn("size-4", tone === "neutral" ? "text-muted-foreground" : "text-tone")} />
            {label}
        </div>
    );
}

function Head({ tone, icon, title, note }: { tone: Tone; icon: React.ComponentType<{ className?: string }>; title: string; note: string }) {
    return (
        <div {...toneAttribute(tone)} className="overflow-hidden rounded-lg border">
            <DialogHead tone={tone} icon={icon} className="border-b-0 px-3 py-2.5">
                <p className="text-sm font-semibold">{title}</p>
                <p className={dialogNoteClass(tone)}>{note}</p>
            </DialogHead>
        </div>
    );
}

/**
 * Real pieces of the app in the colors being picked, before they are saved: a row menu, the heads
 * of three dialogs, the buttons, the states of a run, a filter and a pick field. The colors come in
 * as CSS variables on the frame around it, which everything inside reads.
 */
export function ColorPreview({ vars }: { vars: Record<string, string> }) {
    return (
        <div className="rounded-xl border bg-page/60 p-4" style={vars as React.CSSProperties}>
            <p className="mb-3 text-xs font-medium tracking-wide text-muted-foreground">HOW IT LOOKS</p>
            <div className="flex flex-wrap items-start gap-4">
                <div className="w-44 rounded-lg border bg-raised p-1 shadow-sm">
                    <Entry icon={Pencil} label="Edit" tone="edit" />
                    <Entry icon={Copy} label="Clone" tone="create" />
                    <Entry icon={Play} label="Run now" tone="neutral" />
                    <div className="my-1 h-px bg-border" />
                    <Entry icon={Trash2} label="Delete" tone="destructive" />
                </div>
                <div className="grid w-72 gap-2">
                    <Head tone="create" icon={Plus} title="New destination" note="Step 1 of 2" />
                    <Head tone="warning" icon={TriangleAlert} title="Restore Shop nightly?" note="Overwrites 2 databases" />
                    <Head tone="destructive" icon={Trash2} title="Delete 3 jobs?" note="Recently deleted keeps them for 30 days" />
                </div>
                <div className="grid gap-3">
                    <div className="flex flex-wrap gap-2">
                        <Button type="button" tone="create" size="sm" tabIndex={-1}>
                            <Plus />
                            New job
                        </Button>
                        <Button type="button" tone="edit" size="sm" tabIndex={-1}>Save</Button>
                        <Button type="button" variant="ghost-destructive" size="sm" tabIndex={-1}>
                            <Trash2 />
                            Delete
                        </Button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                        <Badge variant="outline" className="border-success/30 bg-success/10 text-success"><CircleCheck />Completed</Badge>
                        <Badge variant="outline" className="border-warning/30 bg-warning/10 text-warning"><TriangleAlert />Partial</Badge>
                        <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-destructive-text"><CircleX />Failed</Badge>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <span {...toneAttribute("filter")} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-tone/60 bg-tone/5 px-2.5 text-xs font-medium">
                            <Funnel className="size-3.5 text-tone" aria-hidden="true" />
                            Job
                            <span className="rounded-full bg-tone/15 px-1.5 text-tone">2</span>
                        </span>
                        <span {...toneAttribute("pick")} className="inline-flex h-8 items-center gap-2 rounded-md border border-tone-ring bg-background px-2.5 text-xs ring-2 ring-tone-ring/40">
                            <Lock className="size-3.5 text-tone" aria-hidden="true" />
                            NAS login
                            <ChevronsUpDown className="size-3.5 text-muted-foreground" aria-hidden="true" />
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );
}
