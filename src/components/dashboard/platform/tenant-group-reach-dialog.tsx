"use client";

import { useState } from "react";
import { Loader2, TriangleAlert } from "lucide-react";
import { ChoiceCards } from "@/components/adapter/connection-mode-choice";
import { TenantTileMark } from "@/components/tenant/tenant-pick";
import { Button } from "@/components/ui/button";
import { DIALOG_FOOTER, DIALOG_SURFACE, DialogHead, dialogNoteClass } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { permissionInfo } from "@/lib/auth/permission-areas";
import { cn } from "@/lib/utils";
import type { ClashChoice, LeaveChoice, ReachClash, ReachLeave, ReachPlan, ReachPreview } from "@/services/user/tenant-group-templates";

/** The pick of the Select that takes the members out of their tenant. */
const NO_GROUP = "none";

interface TenantGroupReachDialogProps {
    name: string;
    preview: ReachPreview;
    /** The button that saves with the answers, like "Create in 3 tenants". */
    confirmLabel: string;
    pending: boolean;
    onBack: () => void;
    onConfirm: (plan: ReachPlan) => void;
}

const people = (count: number) => `${count} ${count === 1 ? "person" : "people"}`;
/** "1 person holds it: test", "2 people hold it: Jonas, Peter". */
const holders = (list: { name: string }[]) => `${people(list.length)} ${list.length === 1 ? "holds" : "hold"} it: ${names(list)}`;
const names = (list: { name: string }[]) => list.map((entry) => entry.name).join(", ");
const label = (permission: string) => permissionInfo(permission)?.label ?? permission;

/**
 * What a save of a group for tenants asks first, one block per tenant: a tenant with a group of its
 * own by the name, whose group the platform takes over or which stays out, and a tenant the group
 * leaves where people hold it, whose group goes with its members moved, or stays as its own. The
 * button waits until every removed group knows where its members go.
 */
export function TenantGroupReachDialog({ name, preview, confirmLabel, pending, onBack, onConfirm }: TenantGroupReachDialogProps) {
    const [clashes, setClashes] = useState<Record<string, ClashChoice>>(() =>
        Object.fromEntries(preview.clashes.map((clash) => [clash.tenantId, clash.fullAccess || clash.beyondYou ? "leaveOut" : "takeOver"])));
    const leaving = preview.leaving.filter((entry) => entry.members.length > 0);
    const [keep, setKeep] = useState<Record<string, boolean>>(() => Object.fromEntries(leaving.map((entry) => [entry.tenantId, false])));
    const [moveTo, setMoveTo] = useState<Record<string, string>>({});

    const ready = leaving.every((entry) => keep[entry.tenantId] || moveTo[entry.tenantId]);
    const single = preview.clashes.length + leaving.length === 1;
    const title = single && preview.clashes.length === 1
        ? `${preview.clashes[0].tenantName} has a group named ${name}`
        : single
          ? `Take ${name} out of ${leaving[0].tenantName}?`
          : `${preview.clashes.length + leaving.length} tenants need a decision`;

    const confirm = () => {
        const plan: ReachPlan = {
            clashes,
            leaving: Object.fromEntries(leaving.map((entry): [string, LeaveChoice] => [entry.tenantId, keep[entry.tenantId]
                ? { keep: true }
                : { keep: false, moveTo: moveTo[entry.tenantId] === NO_GROUP ? null : moveTo[entry.tenantId] }])),
        };
        onConfirm(plan);
    };

    return (
        <Dialog open onOpenChange={(next) => !next && !pending && onBack()}>
            <DialogContent tone="warning" showCloseButton={false} className={cn(DIALOG_SURFACE, "sm:max-w-2xl")}>
                <DialogHead tone="warning" icon={TriangleAlert}>
                    <DialogTitle className="text-base">{title}</DialogTitle>
                    <DialogDescription className={dialogNoteClass("warning")}>Decide what happens there before the group is saved</DialogDescription>
                </DialogHead>

                <ScrollArea className="*:data-[slot=scroll-area-viewport]:max-h-[calc(95dvh-9.5rem)]">
                    <div className="space-y-5 p-5">
                        {preview.clashes.map((clash) => (
                            <ClashBlock key={clash.tenantId} name={name} clash={clash} value={clashes[clash.tenantId]} onChange={(next) => setClashes((current) => ({ ...current, [clash.tenantId]: next }))} />
                        ))}
                        {leaving.map((entry) => (
                            <LeaveBlock
                                key={entry.tenantId}
                                name={name}
                                entry={entry}
                                keep={keep[entry.tenantId]}
                                onKeepChange={(next) => setKeep((current) => ({ ...current, [entry.tenantId]: next }))}
                                moveTo={moveTo[entry.tenantId] ?? ""}
                                onMoveToChange={(next) => setMoveTo((current) => ({ ...current, [entry.tenantId]: next }))}
                            />
                        ))}
                        {preview.clashes.length > 0 && (
                            <p className="text-xs text-muted-foreground">A name is used once inside a tenant. Everything else goes by the id of a group, so a rename never changes who holds it.</p>
                        )}
                    </div>
                </ScrollArea>

                <div className={cn(DIALOG_FOOTER, "flex justify-end gap-2")}>
                    <Button variant="outline" onClick={onBack} disabled={pending}>Back</Button>
                    <Button onClick={confirm} disabled={pending || !ready}>
                        {pending && <Loader2 className="animate-spin" />}
                        {confirmLabel}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}

function TenantLine({ name, line }: { name: string; line: string }) {
    return (
        <div className="flex min-w-0 items-center gap-3">
            <TenantTileMark name={name} />
            <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{name}</p>
                <p className="truncate text-xs text-muted-foreground">{line}</p>
            </div>
        </div>
    );
}

function ClashBlock({ name, clash, value, onChange }: { name: string; clash: ReachClash; value: ClashChoice; onChange: (next: ClashChoice) => void }) {
    const line = clash.members.length > 0 ? `has a ${name} of its own, ${holders(clash.members)}` : `has a ${name} of its own, nobody holds it`;
    return (
        <section className="space-y-3">
            <TenantLine name={clash.tenantName} line={line} />
            <ChoiceCards
                value={value}
                onValueChange={(next) => onChange(next as ClashChoice)}
                className="sm:grid-cols-1"
                options={[
                    {
                        value: "takeOver",
                        title: `Take over the ${name} of ${clash.tenantName}`,
                        description: "It becomes this group: its members keep it, the platform changes it from now on.",
                        // Nobody takes over a group that may do more than they may, the server refuses it too.
                        disabled: clash.fullAccess || clash.beyondYou,
                        ...(clash.fullAccess ? { badge: "Holds every permission" } : clash.beyondYou ? { badge: "May do more than you" } : {}),
                    },
                    { value: "leaveOut", title: `Leave ${clash.tenantName} out`, description: `It keeps its own ${name}. Once that name is free, pick ${clash.tenantName} again.` },
                ]}
            />
            {value === "takeOver" && (clash.added.length > 0 || clash.removed.length > 0) && (
                <div className="rounded-lg border bg-muted/30 p-3 text-xs">
                    <p className="mb-1 font-semibold">Its rights change to those of this group</p>
                    {clash.added.map((permission) => <p key={permission}><span className="mr-1.5 font-semibold text-success">+</span>{label(permission)}</p>)}
                    {clash.removed.map((permission) => <p key={permission}><span className="mr-1.5 font-semibold text-destructive-text">-</span>{label(permission)}</p>)}
                </div>
            )}
        </section>
    );
}

interface LeaveBlockProps {
    name: string;
    entry: ReachLeave;
    keep: boolean;
    onKeepChange: (keep: boolean) => void;
    moveTo: string;
    onMoveToChange: (groupId: string) => void;
}

function LeaveBlock({ name, entry, keep, onKeepChange, moveTo, onMoveToChange }: LeaveBlockProps) {
    return (
        <section className="space-y-3">
            <TenantLine name={entry.tenantName} line={`loses ${name}, ${holders(entry.members)}`} />
            <ChoiceCards
                value={keep ? "keep" : "remove"}
                onValueChange={(next) => onKeepChange(next === "keep")}
                className="sm:grid-cols-1"
                options={[
                    { value: "remove", title: `Remove it from ${entry.tenantName}`, description: `${name} is gone there, its members get the group you pick.` },
                    { value: "keep", title: `Keep it as a group of ${entry.tenantName}`, description: "Its members keep their rights. From now on the tenant changes and deletes it." },
                ]}
            />
            {!keep && (
                <div className="space-y-2">
                    <Label>Move its {people(entry.members.length)} to</Label>
                    <Select value={moveTo} onValueChange={onMoveToChange}>
                        <SelectTrigger className="w-full" aria-label={`Group for the members in ${entry.tenantName}`}>
                            <SelectValue placeholder="Pick a group" />
                        </SelectTrigger>
                        <SelectContent>
                            {entry.groups.map((group) => <SelectItem key={group.id} value={group.id}>{group.name}</SelectItem>)}
                            <SelectItem value={NO_GROUP}>No group, they leave {entry.tenantName}</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            )}
        </section>
    );
}
