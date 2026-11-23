"use client";

import { useId, useMemo, useState } from "react";
import { Building2, Database, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { addAssignmentRule } from "@/app/actions/tenant/database-assignments";
import { TenantTileMark } from "@/components/tenant/tenant-pick";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumberStepper } from "@/components/ui/number-stepper";
import { PickList, PickTrigger } from "@/components/ui/pick-list";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toneAttribute } from "@/components/ui/tone";
import { useDateFormatter } from "@/hooks/use-date-formatter";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { cn } from "@/lib/utils";
import type { SourceAssignments } from "@/services/tenant/database-assignments";
import { countOf, dayAllowed, rulePreview, startOf } from "./assignment-model";
import { useTenantEntries } from "./assignment-picker";
import { ruleTakeover } from "./assignment-reach";
import { StartChoice } from "./assignment-start";

const log = logger.child({ component: "assignment-rule-form" });

/** The limits the server checks, kept here so the fields never offer more. */
const PATTERN_MAX = 100;
const PRIORITY_MIN = -1000;
const PRIORITY_MAX = 1000;

/** The tenant a rule gives to, from the tenants the viewer reaches but the one of the server. */
function TenantField({ id, data, value, onChange }: { id: string; data: SourceAssignments; value: string | null; onChange: (id: string) => void }) {
    const [open, setOpen] = useState(false);
    const entries = useTenantEntries(data);
    const current = data.customers.find((tenant) => tenant.id === value);
    return (
        <Popover open={open} onOpenChange={setOpen} modal>
            <PopoverTrigger asChild>
                <PickTrigger id={id} icon={Building2} leading={current ? <TenantTileMark name={current.name} className="size-5 text-[9px]" /> : undefined} aria-expanded={open} className="h-9 w-full bg-card">
                    {current ? <span className="truncate">{current.name}</span> : <span className="truncate text-muted-foreground">Pick a tenant</span>}
                </PickTrigger>
            </PopoverTrigger>
            <PopoverContent tone="pick" align="start" className="w-(--radix-popover-trigger-width) min-w-72 overflow-hidden bg-raised p-0">
                <PickList
                    icon={Building2}
                    title="Pick a tenant"
                    note="It sees the backups of the databases the rule gives"
                    groups={[{ entries }]}
                    value={value}
                    emptyText="No tenant matches."
                    searchPlaceholder="Search tenants"
                    onPick={(picked) => {
                        onChange(picked);
                        setOpen(false);
                    }}
                />
            </PopoverContent>
        </Popover>
    );
}

interface RuleFormProps {
    serverId: string;
    serverName: string;
    data: SourceAssignments;
    onCancel: () => void;
    onAdded: () => void;
}

/**
 * New rule, right in the panel of the rules in the blue of adding: a pattern of names, the tenant
 * that gets what it matches, a priority for rules that overlap and when it starts, today or
 * earlier. Below the fields a preview follows every key: which databases of the server it would
 * give, and which stay where they are.
 */
export function RuleForm({ serverId, serverName, data, onCancel, onAdded }: RuleFormProps) {
    const { formatDate, timezone } = useDateFormatter();
    const [pattern, setPattern] = useState("");
    const [tenantId, setTenantId] = useState<string | null>(data.customers.length === 1 ? data.customers[0].id : null);
    const [priority, setPriority] = useState(0);
    const [day, setDay] = useState<Date | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [pending, setPending] = useState(false);
    const ids = { pattern: useId(), tenant: useId(), priority: useId() };
    const now = useMemo(() => new Date(), []);
    const start = startOf(day, timezone, now);
    const tenant = data.customers.find((entry) => entry.id === tenantId) ?? null;
    const effects = useMemo(() => rulePreview(data, { pattern, tenantId, priority }, now), [data, pattern, tenantId, priority, now]);
    const gains = effects.filter((effect) => effect.outcome === "gains").length;
    // The server refuses a rule that takes a database from a tenant beyond the reach of the viewer.
    const takeover = useMemo(() => ruleTakeover(data, effects), [data, effects]);
    const ready = pattern.trim().length > 0 && tenant !== null && !takeover;
    const fromLabel = start ? `From ${formatDate(start, "MMM d")}` : "From now";

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!ready || pending) return;
        setPending(true);
        try {
            const result = await addAssignmentRule(serverId, { pattern: pattern.trim(), tenantId: tenant.id, priority, ...(start ? { validFrom: start } : {}) });
            if (!result.success) {
                setError(result.error);
                return;
            }
            toast.success(`The rule ${result.data.pattern} gives to ${result.data.tenantName}`, { description: `It gives ${countOf(gains, "database")} of ${serverName} now.` });
            onAdded();
        } catch (failure: unknown) {
            log.warn("Adding a rule failed", { serverId }, wrapError(failure));
            setError("The rule could not be added.");
        } finally {
            setPending(false);
        }
    };

    return (
        <form {...toneAttribute("create")} onSubmit={submit} noValidate aria-label="New rule" className="space-y-3 rounded-xl border border-tone/40 bg-tone/5 p-4 dark:bg-tone/10">
            <p className="flex flex-wrap items-baseline gap-x-2 text-sm font-semibold">
                <span className="inline-flex items-center gap-1.5"><Plus className="size-4 text-tone" aria-hidden="true" />New rule</span>
                <span className="text-xs font-normal text-tone">the preview follows what you type</span>
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                    <Label htmlFor={ids.pattern}>Pattern</Label>
                    <Input
                        id={ids.pattern}
                        value={pattern}
                        maxLength={PATTERN_MAX}
                        placeholder="shop_*"
                        className="bg-card font-mono"
                        autoComplete="off"
                        autoFocus
                        disabled={pending}
                        aria-invalid={error ? true : undefined}
                        aria-describedby={`${ids.pattern}-message`}
                        onChange={(event) => {
                            setPattern(event.target.value);
                            setError(null);
                        }}
                    />
                </div>
                <div className="space-y-1.5">
                    <Label htmlFor={ids.tenant}>Tenant</Label>
                    <TenantField id={ids.tenant} data={data} value={tenantId} onChange={setTenantId} />
                </div>
                <div className="space-y-1.5">
                    <Label htmlFor={ids.priority}>Priority</Label>
                    <NumberStepper id={ids.priority} value={priority} onValueChange={setPriority} min={PRIORITY_MIN} max={PRIORITY_MAX} decrementLabel="Lower priority" incrementLabel="Higher priority" disabled={pending} />
                </div>
                <StartChoice label="Starts" day={day} onChange={setDay} isAllowed={(candidate) => dayAllowed(candidate, timezone, now)} />
            </div>
            <p id={`${ids.pattern}-message`} className={cn("text-xs", error || takeover ? "text-destructive" : "text-muted-foreground")}>
                {error ?? takeover ?? "* stands for any characters and ? for one. Capitals count. Where rules overlap the higher priority wins, and a name given by hand beats every rule."}
            </p>

            <div className="space-y-1.5">
                <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">What it would give</p>
                {!pattern.trim() ? (
                    <p className="text-xs text-muted-foreground">Type a pattern to see which databases of {serverName} it matches.</p>
                ) : (
                    <>
                        {effects.length > 0 && (
                            <ul className="divide-y rounded-lg border bg-card">
                                {effects.map((effect) => (
                                    <li key={effect.name} className="flex min-w-0 items-center gap-2.5 px-3 py-2 text-sm">
                                        <Database className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                                        <span className="shrink-0 font-mono">{effect.name}</span>
                                        <span className="min-w-0 truncate text-xs text-muted-foreground">{effect.outcome === "gains" ? `goes to ${tenant?.name ?? "the tenant"}` : effect.reason}</span>
                                        <span className={cn("ml-auto shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium", effect.outcome === "gains" ? "bg-tone/12 text-tone" : "bg-muted text-muted-foreground")}>
                                            {effect.outcome === "gains" ? fromLabel : "Stays"}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        )}
                        <p className="text-xs text-muted-foreground">
                            {effects.length === 0 ? `No database of ${serverName} matches it now. ` : ""}And every database named {pattern.trim()} the server gets later.
                        </p>
                    </>
                )}
            </div>

            <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={pending}>Cancel</Button>
                <Button type="submit" size="sm" disabled={!ready || pending}>
                    {pending ? <Loader2 className="animate-spin" /> : <Plus />}
                    Add rule
                </Button>
            </div>
        </form>
    );
}
