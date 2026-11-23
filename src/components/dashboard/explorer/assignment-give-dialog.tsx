"use client";

import { useMemo, useState } from "react";
import { Building2, Database, Info, Loader2 } from "lucide-react";
import { TenantTileMark } from "@/components/tenant/tenant-pick";
import { Button } from "@/components/ui/button";
import { DIALOG_FOOTER, DIALOG_SURFACE, DialogHead, dialogNoteClass } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useDateFormatter } from "@/hooks/use-date-formatter";
import { cn, formatBytes } from "@/lib/utils";
import type { DatabaseOwnerRow, SourceAssignments } from "@/services/tenant/database-assignments";
import { countOf, dayAllowed, giveChanges, heldAfter, holdingOf, holdingText, startOf } from "./assignment-model";
import { useRangeText, type OwnerChange } from "./assignment-picker";
import { StartChoice } from "./assignment-start";

interface GiveDialogProps {
    rows: DatabaseOwnerRow[];
    data: SourceAssignments;
    serverName: string;
    /** The tenant of the server. */
    tenantName: string;
    onClose: () => void;
    /** Saves the changes, true once they went through. */
    onGive: (changes: OwnerChange[]) => Promise<boolean>;
}

/** Who holds a database now, in the list of the dialog. */
function nowText(row: DatabaseOwnerRow): string {
    if (!row.owner) return "Nobody else now";
    return row.owner.via === "rule" ? `${row.owner.tenantName} now, by a rule` : `${row.owner.tenantName} now, by name`;
}

/**
 * Give to tenant for the databases picked in the table, in the turquoise of picking: the databases
 * with who holds each now, the tenants as cards with what each holds of the server, and from when
 * the tenant sees their backups. Given by name, they stay with the tenant whatever a rule says.
 */
export function GiveDialog({ rows, data, serverName, tenantName, onClose, onGive }: GiveDialogProps) {
    const { formatDate, timezone } = useDateFormatter();
    const range = useRangeText();
    const [tenantId, setTenantId] = useState<string | null>(data.customers.length === 1 ? data.customers[0].id : null);
    const [day, setDay] = useState<Date | null>(null);
    const [pending, setPending] = useState(false);
    const now = useMemo(() => new Date(), []);
    const tenant = data.customers.find((entry) => entry.id === tenantId) ?? null;
    const start = startOf(day, timezone, now);
    const plan = tenant ? giveChanges(rows, tenant.id, start) : null;
    const given = plan?.changes.length ?? 0;

    const give = async () => {
        if (!plan || plan.changes.length === 0) return;
        setPending(true);
        try {
            if (await onGive(plan.changes)) onClose();
        } finally {
            setPending(false);
        }
    };

    return (
        <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
            <DialogContent tone="pick" showCloseButton={false} className={cn(DIALOG_SURFACE, "sm:max-w-xl")}>
                <DialogHead tone="pick" icon={Building2}>
                    <DialogTitle className="text-base">Give {countOf(rows.length, "database")} to a tenant</DialogTitle>
                    <DialogDescription className={dialogNoteClass("pick")}>{serverName} · who sees their backups</DialogDescription>
                </DialogHead>

                <ScrollArea className="*:data-[slot=scroll-area-viewport]:max-h-[calc(95dvh-9.5rem)]">
                    <div className="space-y-5 p-5">
                        <section className="space-y-2">
                            <h3 className="text-sm font-medium">Databases</h3>
                            <ScrollArea className="rounded-lg border *:data-[slot=scroll-area-viewport]:max-h-40">
                                <ul className="divide-y">
                                    {rows.map((row) => (
                                        <li key={row.name} className="flex min-w-0 items-center gap-3 px-3 py-2 text-sm">
                                            <Database className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                                            <span className="min-w-0 truncate font-medium">{row.name}</span>
                                            {row.sizeInBytes !== null && <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{formatBytes(row.sizeInBytes)}</span>}
                                            <span className="ml-auto shrink-0 text-xs text-muted-foreground">{nowText(row)}</span>
                                        </li>
                                    ))}
                                </ul>
                            </ScrollArea>
                        </section>

                        <section className="space-y-2">
                            <h3 className="text-sm font-medium">Tenant</h3>
                            <RadioGroup value={tenantId ?? ""} onValueChange={setTenantId} className="grid gap-2" aria-label="Tenant">
                                {data.customers.map((entry) => (
                                    <Label
                                        key={entry.id}
                                        htmlFor={`give-${entry.id}`}
                                        className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 font-normal transition-colors hover:bg-muted/40 has-data-[state=checked]:border-tone/60 has-data-[state=checked]:bg-tone/5 dark:has-data-[state=checked]:bg-tone/10"
                                    >
                                        <RadioGroupItem id={`give-${entry.id}`} value={entry.id} className="shrink-0" />
                                        <TenantTileMark name={entry.name} />
                                        <span className="grid min-w-0 gap-0.5">
                                            <span className="truncate text-sm font-medium">{entry.name}</span>
                                            <span className="truncate text-xs text-muted-foreground">{holdingText(holdingOf(entry.id, data), range)}</span>
                                        </span>
                                    </Label>
                                ))}
                            </RadioGroup>
                        </section>

                        <StartChoice label="Starts" day={day} onChange={setDay} isAllowed={(candidate) => dayAllowed(candidate, timezone, now)}>
                            {tenant
                                ? start
                                    ? `Backups from ${formatDate(start, "P")} on show to ${tenant.name}. A database another tenant held by name since then starts when that time ended.`
                                    : `Backups from now on show to ${tenant.name}.`
                                : "Pick a tenant first."}
                        </StartChoice>

                        <p className="flex gap-2.5 rounded-lg border bg-muted/30 px-3 py-2.5 text-sm text-muted-foreground">
                            <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                            <span>
                                Given by name, they stay with {tenant?.name ?? "the tenant"} even when a rule matches them later. A name beats every rule.
                                {plan && plan.unchanged.length > 0 && ` ${plan.unchanged.join(", ")} ${plan.unchanged.length === 1 ? "is" : "are"} given to ${tenant?.name} by name already and stay${plan.unchanged.length === 1 ? "s" : ""} as ${plan.unchanged.length === 1 ? "it is" : "they are"}.`}
                            </span>
                        </p>
                    </div>
                </ScrollArea>

                <div className={cn(DIALOG_FOOTER, "flex flex-wrap items-center justify-end gap-2")}>
                    <p className="mr-auto min-w-0 text-xs text-muted-foreground">
                        {tenant ? `${tenant.name} then holds ${countOf(heldAfter(data.databases, plan?.changes.map((change) => change.databaseName) ?? [], tenant.id), "database")} of this server.` : `Only ${tenantName} sees them until then.`}
                    </p>
                    <Button variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
                    <Button onClick={() => void give()} disabled={!tenant || given === 0 || pending} className="min-w-0">
                        {pending ? <Loader2 className="animate-spin" /> : <Building2 />}
                        <span className="truncate">{tenant ? `Give ${given.toLocaleString()} to ${tenant.name}` : "Give to tenant"}</span>
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
