"use client";

import { useState } from "react";
import { ShieldCheck, UserRound, Users } from "lucide-react";
import type { TenantMembersData } from "@/app/actions/tenant/members";
import { PickList, PickTrigger, type PickEntry } from "@/components/ui/pick-list";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type Group = TenantMembersData["groups"][number];
type Account = TenantMembersData["accounts"][number];

/** What a group lets its members do, as far as the list of members knows it. */
function groupEntry(group: Group): PickEntry {
    return { id: group.id, name: group.name, meta: group.fullAccess ? "Every permission, in every area" : "The permissions set under Groups", glyph: group.fullAccess ? ShieldCheck : undefined };
}

interface TenantGroupPickerProps {
    groups: Group[];
    /** The id of the picked group, an empty string while none is. */
    value: string;
    onChange: (groupId: string) => void;
    /** What the list says the group is for, like "What Lena may do in Acme". */
    note: string;
    /** The id a `Label` names the field by. */
    id?: string;
    disabled?: boolean;
    className?: string;
    /** Names the field where no `Label` does, like the group of one member. */
    "aria-label"?: string;
}

/** Picks the group of someone in a tenant from a list with a search, in the turquoise of picking. */
export function TenantGroupPicker({ groups, value, onChange, note, id, disabled, className, "aria-label": label }: TenantGroupPickerProps) {
    const [open, setOpen] = useState(false);
    const current = groups.find((group) => group.id === value);
    return (
        <Popover open={open} onOpenChange={setOpen} modal>
            <PopoverTrigger asChild>
                <PickTrigger id={id} icon={current?.fullAccess ? ShieldCheck : Users} aria-expanded={open} aria-label={label} disabled={disabled} className={cn("h-9", className)}>
                    {current ? <span className="truncate">{current.name}</span> : <span className="truncate text-muted-foreground">Pick a group</span>}
                </PickTrigger>
            </PopoverTrigger>
            <PopoverContent tone="pick" align="end" className="w-(--radix-popover-trigger-width) min-w-72 overflow-hidden bg-raised p-0">
                <PickList
                    icon={Users}
                    title="Pick a group"
                    note={note}
                    groups={[{ entries: groups.map(groupEntry) }]}
                    value={value}
                    emptyText="No group matches."
                    searchPlaceholder="Search groups"
                    onPick={(id) => {
                        onChange(id);
                        setOpen(false);
                    }}
                />
            </PopoverContent>
        </Popover>
    );
}

interface AccountPickerProps {
    accounts: Account[];
    value: string;
    onChange: (accountId: string) => void;
    /** The name of the tenant, for the line of the list. */
    tenantName: string;
    /** The id a `Label` names the field by. */
    id?: string;
    disabled?: boolean;
    className?: string;
}

/** Picks any account of this DBackup that is no member of the tenant yet, by its name or email. */
export function AccountPicker({ accounts, value, onChange, tenantName, id, disabled, className }: AccountPickerProps) {
    const [open, setOpen] = useState(false);
    const current = accounts.find((account) => account.id === value);
    const entries: PickEntry[] = accounts.map((account) => ({
        id: account.id,
        name: account.name || account.email,
        meta: account.platformAdmin ? `${account.email} · Platform admin` : account.email,
        // Two people may share a name, never an email.
        value: `${account.name} ${account.email}`,
        keywords: [account.email],
    }));
    return (
        <Popover open={open} onOpenChange={setOpen} modal>
            <PopoverTrigger asChild>
                <PickTrigger id={id} icon={UserRound} aria-expanded={open} disabled={disabled} className={cn("h-9", className)}>
                    {current ? <span className="truncate">{current.name || current.email}</span> : <span className="truncate text-muted-foreground">Pick an account</span>}
                </PickTrigger>
            </PopoverTrigger>
            <PopoverContent tone="pick" align="start" className="w-(--radix-popover-trigger-width) min-w-80 overflow-hidden bg-raised p-0">
                <PickList
                    icon={UserRound}
                    title="Pick an account"
                    note={`Every account that does not work in ${tenantName} yet`}
                    groups={[{ entries }]}
                    value={value}
                    emptyText={accounts.length === 0 ? "Every account works here already." : "No account matches."}
                    searchPlaceholder="Search by name or email"
                    onPick={(id) => {
                        onChange(id);
                        setOpen(false);
                    }}
                />
            </PopoverContent>
        </Popover>
    );
}
