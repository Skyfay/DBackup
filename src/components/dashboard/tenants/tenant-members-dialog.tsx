"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { Loader2, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import { getTenantMembers, setPlatformAdmin, setTenantMember, type TenantMembersData } from "@/app/actions/tenant/members";
import { Button } from "@/components/ui/button";
import { DIALOG_FOOTER, DIALOG_SURFACE, DialogHead, dialogNoteClass } from "@/components/ui/confirm-dialog";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { cn } from "@/lib/utils";
import type { TenantMember } from "@/services/tenant/membership-service";
import { MemberConfirmDialog, MemberRow, type MemberConfirm } from "./tenant-member-row";
import { AccountPicker, TenantGroupPicker } from "./tenant-pickers";
import { addableAccounts, countOf } from "./tenant-words";

const log = logger.child({ component: "tenant-members-dialog" });

type Result = { success: true } | { success: false; error: string };

interface TenantMembersDialogProps {
    tenant: { id: string; name: string };
    viewerId: string;
    /** May add, move and remove members. Otherwise the dialog lists them. */
    canManage?: boolean;
    /** Only a platform admin makes someone one, and changes their own membership or that of a platform admin. */
    viewerPlatformAdmin?: boolean;
    onClose: () => void;
    /** After any change, so the list of tenants counts its members again. */
    onChanged: () => void;
}

/**
 * Who works in a tenant with which group, as whoever manages the tenants decides it: the group of
 * each member changes at once, Add member picks any account of this DBackup with a group, and the
 * menu of a member removes them, or for a platform admin changes whether they are one. Someone who
 * may only see the tenants gets the list alone.
 */
export function TenantMembersDialog({ tenant, viewerId, canManage = true, viewerPlatformAdmin = true, onClose, onChanged }: TenantMembersDialogProps) {
    const [data, setData] = useState<TenantMembersData | null>(null);
    const [problem, setProblem] = useState<string | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const [confirm, setConfirm] = useState<MemberConfirm | null>(null);
    const [accountId, setAccountId] = useState("");
    const [groupId, setGroupId] = useState("");
    const accountField = useId();
    const groupField = useId();

    const load = useCallback(async () => {
        try {
            const result = await getTenantMembers(tenant.id);
            if (result.success) {
                setData(result.data);
                setProblem(null);
            } else {
                setProblem(result.error);
            }
        } catch (error: unknown) {
            log.warn("Loading the members of a tenant failed", { tenantId: tenant.id }, wrapError(error));
            setProblem("The members could not be loaded.");
        }
    }, [tenant.id]);

    useEffect(() => {
        void load();
    }, [load]);

    /** Runs one change, reports it, and loads the members and the list behind the dialog again. */
    const change = async (id: string, action: () => Promise<Result>, success: string): Promise<boolean> => {
        setBusy(id);
        try {
            const result = await action();
            if (!result.success) {
                toast.error(result.error);
                return false;
            }
            toast.success(success);
            await load();
            onChanged();
            return true;
        } catch (error: unknown) {
            log.warn("Changing a member of a tenant failed", { tenantId: tenant.id }, wrapError(error));
            toast.error("The member could not be changed.");
            return false;
        } finally {
            setBusy(null);
        }
    };

    const nameOf = (member: Pick<TenantMember, "name" | "email">) => member.name || member.email;
    const groupName = (id: string) => data?.groups.find((group) => group.id === id)?.name ?? "the group";

    const setGroup = (member: TenantMember, next: string) =>
        void change(member.id, () => setTenantMember(tenant.id, member.id, next), `${nameOf(member)} is in ${groupName(next)} now`);

    const add = async () => {
        const account = data?.accounts.find((entry) => entry.id === accountId);
        if (!account || !groupId) return;
        const added = await change("add", () => setTenantMember(tenant.id, account.id, groupId), `${nameOf(account)} works in ${tenant.name} now`);
        if (added) {
            setAccountId("");
            setGroupId("");
        }
    };

    const confirmed = async (entry: MemberConfirm) => {
        const name = nameOf(entry.member);
        const done = entry.kind === "remove"
            ? await change(entry.member.id, () => setTenantMember(tenant.id, entry.member.id, null), `${name} is removed from ${tenant.name}`)
            : await change(entry.member.id, () => setPlatformAdmin(entry.member.id, entry.on), entry.on ? `${name} is a platform admin now` : `${name} is no platform admin any more`);
        if (done) setConfirm(null);
    };

    const addable = data ? addableAccounts(data) : [];

    return (
        <Dialog open onOpenChange={(open) => !open && !confirm && onClose()}>
            <DialogContent tone={canManage ? "edit" : "neutral"} showCloseButton={false} className={cn(DIALOG_SURFACE, "sm:max-w-2xl")}>
                <DialogHead tone={canManage ? "edit" : "neutral"} icon={Users}>
                    <DialogTitle className="truncate text-base">Members of {tenant.name}</DialogTitle>
                    <DialogDescription className={dialogNoteClass(canManage ? "edit" : "neutral")}>
                        {data ? `${countOf(data.members.length, "member")} · who works here with which group` : "Who works here with which group"}
                    </DialogDescription>
                </DialogHead>

                <ScrollArea className="*:data-[slot=scroll-area-viewport]:max-h-[calc(95dvh-9.5rem)]">
                    {/* Add member on top, its button in the blue of adding. */}
                    {canManage && (
                        <div className="grid gap-3 border-b bg-muted/20 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,12rem)_auto] sm:items-end">
                            <div className="min-w-0 space-y-2">
                                <Label htmlFor={accountField}>Add member</Label>
                                <AccountPicker id={accountField} accounts={addable} value={accountId} onChange={setAccountId} tenantName={tenant.name} disabled={!data || busy === "add"} />
                            </div>
                            <div className="min-w-0 space-y-2">
                                <Label htmlFor={groupField}>Group</Label>
                                <TenantGroupPicker id={groupField} groups={data?.groups ?? []} value={groupId} onChange={setGroupId} note={`What they may do in ${tenant.name}`} disabled={!data || busy === "add"} />
                            </div>
                            <Button type="button" tone="create" onClick={() => void add()} disabled={!accountId || !groupId || busy === "add"}>
                                {busy === "add" ? <Loader2 className="animate-spin" /> : <UserPlus />}
                                Add
                            </Button>
                        </div>
                    )}

                    {problem ? (
                        <p role="alert" className="px-5 py-8 text-center text-sm text-muted-foreground">{problem}</p>
                    ) : !data ? (
                        <ul className="divide-y" aria-label="Loading the members">
                            {[0, 1, 2].map((index) => (
                                <li key={index} className="flex items-center gap-3 px-5 py-3">
                                    <Skeleton className="size-8 rounded-full" />
                                    <div className="grid flex-1 gap-1.5">
                                        <Skeleton className="h-3.5 w-32" />
                                        <Skeleton className="h-3 w-44" />
                                    </div>
                                    <Skeleton className="hidden h-9 w-48 sm:block" />
                                </li>
                            ))}
                        </ul>
                    ) : data.members.length === 0 ? (
                        <div className="flex flex-col items-center gap-2 px-5 py-10 text-center">
                            <Users className="size-6 text-muted-foreground" aria-hidden="true" />
                            <p className="text-sm font-medium">Nobody works in {tenant.name} yet</p>
                            {canManage && <p className="max-w-sm text-sm text-muted-foreground">Add an account above with a group that may manage the users, so the tenant can invite its own people.</p>}
                        </div>
                    ) : (
                        <ul className="divide-y">
                            {data.members.map((member) => (
                                <MemberRow
                                    key={member.id}
                                    member={member}
                                    tenantName={tenant.name}
                                    groups={data.groups}
                                    isViewer={member.id === viewerId}
                                    canManage={canManage}
                                    viewerPlatformAdmin={viewerPlatformAdmin}
                                    busy={busy === member.id}
                                    onGroup={setGroup}
                                    onConfirm={setConfirm}
                                />
                            ))}
                        </ul>
                    )}
                </ScrollArea>

                <div className={cn(DIALOG_FOOTER, "flex items-center justify-between gap-3")}>
                    <p className="min-w-0 text-xs text-muted-foreground">Platform admins open every tenant, member or not.</p>
                    <DialogClose asChild>
                        <Button type="button" variant="outline">Close</Button>
                    </DialogClose>
                </div>
            </DialogContent>

            {confirm && (
                <MemberConfirmDialog confirm={confirm} tenantName={tenant.name} pending={busy === confirm.member.id} onClose={() => setConfirm(null)} onConfirm={(entry) => void confirmed(entry)} />
            )}
        </Dialog>
    );
}
