"use client";

import { useState } from "react";
import { Loader2, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { deleteTenantGroupTemplate } from "@/app/actions/auth/tenant-group-template";
import { ChoiceCards } from "@/components/adapter/connection-mode-choice";
import { MemberFaces } from "@/components/dashboard/groups/group-cells";
import { TenantTileMark } from "@/components/tenant/tenant-pick";
import { useTenantName } from "@/components/tenant/tenant-view";
import { Button } from "@/components/ui/button";
import { DIALOG_FOOTER, DIALOG_SURFACE, DialogHead, dialogNoteClass } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { cn } from "@/lib/utils";
import type { GroupRow, TenantGroupTemplateRow } from "@/services/user/groups-types";
import { groupsIn } from "./tenant-group-template-model";

const log = logger.child({ component: "tenant-group-template-delete-dialog" });

/** The pick of a Select that takes the members out of their tenant. */
const NO_GROUP = "none";

interface TenantGroupTemplateDeleteDialogProps {
    template: TenantGroupTemplateRow;
    /** Every group of every tenant, for where the members of each tenant go. */
    groups: readonly GroupRow[];
    onClose: () => void;
    onDeleted: () => void;
}

/**
 * Deletes a group for tenants after asking what becomes of its group in each tenant: removed, its
 * members moved to a group picked per tenant or to none, or kept as each tenant's own. The button
 * waits until every tenant with members knows where they go.
 */
export function TenantGroupTemplateDeleteDialog({ template, groups, onClose, onDeleted }: TenantGroupTemplateDeleteDialogProps) {
    const nameOf = useTenantName();
    const [keep, setKeep] = useState(false);
    const [moveTo, setMoveTo] = useState<Record<string, string>>({});
    const [pending, setPending] = useState(false);
    const held = template.groups.filter((group) => group.members.length > 0);
    const ready = keep || held.every((group) => moveTo[group.tenantId]);
    const leftOut = keep ? [] : held.filter((group) => moveTo[group.tenantId] === NO_GROUP).flatMap((group) => group.members.map((member) => member.name));
    const tenants = template.groups.length;

    const confirm = async () => {
        setPending(true);
        try {
            const leaving = Object.fromEntries(template.groups.map((group) => [group.tenantId, keep
                ? { keep: true as const }
                : { keep: false as const, moveTo: !moveTo[group.tenantId] || moveTo[group.tenantId] === NO_GROUP ? null : moveTo[group.tenantId] }]));
            const result = await deleteTenantGroupTemplate(template.id, leaving);
            if (!result.success) {
                toast.error(result.error);
                return;
            }
            toast.success(`${template.name} deleted`, keep ? { description: `Each of its ${tenants} tenants keeps it as its own.` } : undefined);
            onDeleted();
        } catch (error: unknown) {
            log.warn("Deleting a group for tenants failed", { templateId: template.id }, wrapError(error));
            toast.error("The group could not be deleted.");
        } finally {
            setPending(false);
        }
    };

    return (
        <Dialog open onOpenChange={(next) => !next && !pending && onClose()}>
            <DialogContent tone="destructive" showCloseButton={false} className={cn(DIALOG_SURFACE, "sm:max-w-2xl")}>
                <DialogHead tone="destructive" icon={Trash2}>
                    <DialogTitle className="text-base">Delete {template.name}?</DialogTitle>
                    <DialogDescription className={dialogNoteClass("destructive")}>
                        A group for tenants, in {tenants} {tenants === 1 ? "tenant" : "tenants"}
                    </DialogDescription>
                </DialogHead>

                <ScrollArea className="*:data-[slot=scroll-area-viewport]:max-h-[calc(95dvh-9.5rem)]">
                    <div className="space-y-4 p-5">
                        <ChoiceCards
                            value={keep ? "keep" : "remove"}
                            onValueChange={(next) => setKeep(next === "keep")}
                            className="sm:grid-cols-1"
                            options={[
                                { value: "remove", title: "Remove it from every tenant", description: "Its members get the group you pick in their tenant." },
                                { value: "keep", title: "Keep it in each tenant as its own group", description: `Nobody loses a right. Each tenant changes and deletes its ${template.name} from now on.` },
                            ]}
                        />

                        {!keep && template.groups.length > 0 && (
                            <div className="overflow-hidden rounded-lg border">
                                <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,9rem)_minmax(0,13rem)] gap-3 border-b bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                                    <span>Tenant</span>
                                    <span>Members</span>
                                    <span>Move them to</span>
                                </div>
                                <ul className="divide-y">
                                    {template.groups.map((group) => {
                                        const name = nameOf(group.tenantId) ?? "A tenant";
                                        const targets = groupsIn(groups, group.tenantId, group.groupId).filter((entry) => !entry.fromPlatform);
                                        return (
                                            <li key={group.tenantId} className="grid grid-cols-[minmax(0,1fr)_minmax(0,9rem)_minmax(0,13rem)] items-center gap-3 px-3 py-2.5">
                                                <span className="flex min-w-0 items-center gap-2.5">
                                                    <TenantTileMark name={name} />
                                                    <span className="truncate text-sm font-medium">{name}</span>
                                                </span>
                                                <MemberFaces members={group.members} max={3} />
                                                {group.members.length === 0 ? (
                                                    <span className="text-xs text-muted-foreground">nothing to move</span>
                                                ) : (
                                                    <Select value={moveTo[group.tenantId] ?? ""} onValueChange={(next) => setMoveTo((current) => ({ ...current, [group.tenantId]: next }))}>
                                                        <SelectTrigger className="w-full" aria-label={`Group for the members in ${name}`}>
                                                            <SelectValue placeholder="Pick a group" />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {targets.map((target) => <SelectItem key={target.id} value={target.id}>{target.name}</SelectItem>)}
                                                            <SelectItem value={NO_GROUP}>No group</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                )}
                                            </li>
                                        );
                                    })}
                                </ul>
                            </div>
                        )}

                        {leftOut.length > 0 && (
                            <p className="flex gap-2.5 rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs">
                                <TriangleAlert className="mt-px size-3.5 shrink-0 text-warning" aria-hidden="true" />
                                <span>{leftOut.join(", ")} {leftOut.length === 1 ? "gets" : "get"} no group and can no longer open {leftOut.length === 1 ? "their tenant" : "their tenants"}.</span>
                            </p>
                        )}
                    </div>
                </ScrollArea>

                <div className={cn(DIALOG_FOOTER, "flex items-center gap-2")}>
                    <span className="mr-auto text-xs text-muted-foreground">Cannot be undone</span>
                    <Button variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
                    <Button variant="destructive" onClick={() => void confirm()} disabled={pending || !ready}>
                        {pending ? <Loader2 className="animate-spin" /> : <Trash2 />}
                        {keep ? `Delete, keep it in ${tenants} ${tenants === 1 ? "tenant" : "tenants"}` : `Delete in ${tenants} ${tenants === 1 ? "tenant" : "tenants"}`}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
