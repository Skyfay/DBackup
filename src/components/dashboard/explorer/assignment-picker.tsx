"use client";

import { useMemo, useState } from "react";
import { Building2, EyeOff } from "lucide-react";
import { TenantTileMark } from "@/components/tenant/tenant-pick";
import { PickList, PickTrigger, type PickEntry } from "@/components/ui/pick-list";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useDateFormatter } from "@/hooks/use-date-formatter";
import type { DatabaseOwnerRow, SourceAssignments } from "@/services/tenant/database-assignments";
import { NOBODY, dayAllowed, holdingOf, holdingText, ownerKey, startLimit, startOf } from "./assignment-model";
import { StartChoice } from "./assignment-start";

/** One change of who a database belongs to, as the card hands it to the server. */
export interface OwnerChange {
    databaseName: string;
    /** The tenant that gets it, null to take it back. */
    tenantId: string | null;
    /** When the tenant's backups start, now when left out. */
    validFrom?: Date;
}

/** "Apr 1 to Jun 30", how long a tenant held a database, for its line in a picker. */
export function useRangeText() {
    const { formatDate } = useDateFormatter();
    return (from: string, until: string) => `${formatDate(from, "MMM d")} to ${formatDate(until, "MMM d")}`;
}

/** The tenants of a picker, each with what it holds of the server now and held before. */
export function useTenantEntries(data: SourceAssignments): PickEntry[] {
    const range = useRangeText();
    return data.customers.map((tenant): PickEntry => ({
        id: tenant.id,
        name: tenant.name,
        meta: holdingText(holdingOf(tenant.id, data), range),
        icon: <TenantTileMark name={tenant.name} className="size-6 border-0 bg-transparent text-[10px]" />,
    }));
}

interface OwnerPickerProps {
    row: DatabaseOwnerRow;
    data: SourceAssignments;
    /** The tenant of the server, which sees every database of it anyway. */
    tenantName: string;
    /** Saves the change, true once it went through. */
    onChange: (changes: OwnerChange[]) => Promise<boolean>;
}

/**
 * Who sees the backups of a database, picked in its row in the turquoise of picking: Nobody else
 * first, then every tenant with what it holds of the server, and when the tenant's backups start
 * in the foot, now or from a day. Nobody else takes back a database a rule gives as well, and no
 * rule gives it again until it is given by name.
 */
export function OwnerPicker({ row, data, tenantName, onChange }: OwnerPickerProps) {
    const { timezone } = useDateFormatter();
    const [open, setOpen] = useState(false);
    const [day, setDay] = useState<Date | null>(null);
    const [pending, setPending] = useState(false);
    const owner = row.owner;
    const tenants = useTenantEntries(data);
    // One moment while the picker is open, so the limit and the days agree.
    const now = useMemo(() => new Date(), []);
    const limit = startLimit(data.assignments, row.name, now);
    const from = limit.kind === "none" ? null : limit.from;

    const toggle = (next: boolean) => {
        if (pending) return;
        setOpen(next);
        if (!next) setDay(null);
    };

    const save = async (change: OwnerChange) => {
        setPending(true);
        try {
            if (await onChange([change])) toggle(false);
        } finally {
            setPending(false);
        }
    };

    const pick = (id: string) => {
        if (id === NOBODY) {
            if (owner) void save({ databaseName: row.name, tenantId: null });
            else toggle(false);
            return;
        }
        // The tenant that holds it already, by name or by a rule, gets nothing new.
        if (owner?.tenantId === id) return toggle(false);
        const validFrom = startOf(day, timezone, new Date(), from);
        void save({ databaseName: row.name, tenantId: id, ...(validFrom ? { validFrom } : {}) });
    };

    const nobody: PickEntry = { id: NOBODY, name: "Nobody else", meta: `Only ${tenantName} sees it`, glyph: EyeOff };

    return (
        <Popover open={open} onOpenChange={toggle} modal>
            <PopoverTrigger asChild>
                <PickTrigger
                    icon={owner ? Building2 : EyeOff}
                    leading={owner ? <TenantTileMark name={owner.tenantName} className="size-5 text-[9px]" /> : undefined}
                    loading={pending}
                    aria-expanded={open}
                    aria-label={`Who sees ${row.name}`}
                    className="h-8 w-full max-w-56"
                >
                    {owner ? <span className="truncate">{owner.tenantName}</span> : <span className="truncate text-muted-foreground">Nobody else</span>}
                </PickTrigger>
            </PopoverTrigger>
            <PopoverContent tone="pick" align="start" className="w-84 overflow-hidden bg-raised p-0">
                <PickList
                    icon={Building2}
                    title={`Who sees ${row.name}`}
                    note="Its backups show there from the start on"
                    groups={[
                        { entries: [nobody] },
                        { heading: "Tenants", entries: tenants },
                    ]}
                    value={ownerKey(row)}
                    emptyText="No tenant matches."
                    searchPlaceholder="Search tenants"
                    onPick={pick}
                    aside={
                        <div className="grid min-w-0 gap-1.5">
                            <StartChoice
                                compact
                                label="Starts"
                                day={day}
                                onChange={setDay}
                                isAllowed={(candidate) => dayAllowed(candidate, timezone, now, from)}
                                earlierDisabled={limit.kind === "current"}
                            />
                            {owner?.via === "rule" && <p className="text-xs text-muted-foreground">A rule gives it to {owner.tenantName}. Nobody else takes it back from the rule.</p>}
                            {limit.kind === "current" && <p className="text-xs text-muted-foreground">{limit.holder ? `${limit.holder} holds it by name` : "It was taken back"}, so a new tenant starts now.</p>}
                        </div>
                    }
                />
            </PopoverContent>
        </Popover>
    );
}
