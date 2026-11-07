"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { Asterisk, Ban, Database, Info, RotateCcw, Zap } from "lucide-react";
import { toast } from "sonner";
import { followTenantOnDemand, getTenantOnDemand } from "@/app/actions/tenant/tenant-on-demand";
import { SwitchList, SwitchRow } from "@/components/adapter/setting-switches";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumberStepper } from "@/components/ui/number-stepper";
import { Skeleton } from "@/components/ui/skeleton";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { ALLOWANCE_KINDS, ALLOWANCE_LABELS, type AllowanceKind, type TenantAllowances } from "@/lib/tenant/allowances";
import { ON_DEMAND_MAX, ON_DEMAND_MIN, ON_DEMAND_OFF } from "@/lib/tenant/sharing";
import { cn } from "@/lib/utils";
import type { TenantOnDemand } from "@/services/tenant/tenant-on-demand";
import type { TenantRow } from "@/services/tenant/tenant-service";
import { providedSentence, sharedParts } from "./tenant-words";

const log = logger.child({ component: "tenant-edit-panes" });

/** The longest name a tenant may have, like the server checks it. */
export const NAME_MAX = 60;

/** The title and the line of a part of Edit of a tenant. */
export function PaneHead({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="space-y-1">
            <h3 className="text-sm font-semibold">{title}</h3>
            <p className="text-sm text-muted-foreground">{children}</p>
        </div>
    );
}

/** A note under the settings of a part, what they mean or when they count. */
export function Note({ children }: { children: React.ReactNode }) {
    return (
        <p className="flex gap-2.5 rounded-lg border bg-muted/30 px-3 py-2.5 text-sm text-muted-foreground">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{children}</span>
        </p>
    );
}

/** The name of the tenant, which its people see at once once it is saved. */
export function GeneralPane({ value, onChange, error, disabled }: { value: string; onChange: (name: string) => void; error: string | null; disabled: boolean }) {
    const nameId = useId();
    return (
        <div className="space-y-2">
            <Label htmlFor={nameId}>Name</Label>
            <Input
                id={nameId}
                value={value}
                maxLength={NAME_MAX}
                placeholder="Acme Corp"
                onChange={(event) => onChange(event.target.value)}
                disabled={disabled}
                autoComplete="off"
                aria-invalid={error ? true : undefined}
                aria-describedby={`${nameId}-message`}
            />
            <p id={`${nameId}-message`} className={cn("text-xs", error ? "text-destructive" : "text-muted-foreground")}>
                {error ?? "Every tenant has a name of its own. Its people see a new one at once."}
            </p>
        </div>
    );
}

/** Whether the tenant shares with customers, a tenant of the MSP. */
export function SharingPane({ tenant, value, onChange, disabled }: { tenant: TenantRow; value: boolean; onChange: (on: boolean) => void; disabled: boolean }) {
    return (
        <div className="space-y-4">
            <SwitchList>
                <SwitchRow
                    title="Shares with customers"
                    description="A tenant of the MSP. It gives single databases, destinations and notification channels to other tenants, by whoever holds Share with customers."
                    checked={value}
                    onCheckedChange={onChange}
                    disabled={disabled || tenant.isHome}
                />
            </SwitchList>
            <Note>
                {tenant.isHome
                    ? "The home tenant shares from the start, it holds what the platform owns."
                    : "Switching it off is refused while it gives anything away. Take back its databases, destinations and channels first, so no customer loses anything by it."}
            </Note>
        </div>
    );
}

/** What each switch lets the tenant do, under its label. */
const DESCRIPTIONS: Record<AllowanceKind, string> = {
    databases: "Its own servers, backed up by its own jobs.",
    directorySources: "Folders of its own servers to back up.",
    destinations: "Off: its jobs write only to the destinations other tenants share with it.",
    channels: "Off: it tells only through the channels other tenants share with it.",
    apiKeys: "Off: no key of it works any more, and nobody makes a new one.",
};

/** What the tenant may add itself, a switch per kind, and what other tenants share with it. */
export function AllowancesPane({ tenant, value, onChange, disabled }: { tenant: TenantRow; value: TenantAllowances; onChange: (next: TenantAllowances) => void; disabled: boolean }) {
    const provided = sharedParts(tenant.provided).length > 0;
    return (
        <div className="space-y-4">
            <SwitchList>
                {ALLOWANCE_KINDS.map((kind) => (
                    <SwitchRow
                        key={kind}
                        title={ALLOWANCE_LABELS[kind]}
                        description={DESCRIPTIONS[kind]}
                        checked={value[kind]}
                        onCheckedChange={(on) => onChange({ ...value, [kind]: on })}
                        disabled={disabled}
                    />
                ))}
            </SwitchList>
            <Note>Off stops new ones, what it has keeps working and stays its own. API keys are the exception, off stops the keys it has too.</Note>
            <section className="space-y-1 border-t pt-4">
                <h4 className="text-sm font-medium">Provided to it</h4>
                <p className={cn("text-sm tabular-nums", !provided && "text-muted-foreground")}>{providedSentence(tenant.provided)}</p>
                <p className="text-xs text-muted-foreground">Set on each destination or channel of the tenant that shares it.</p>
            </section>
        </div>
    );
}

export interface OnDemandDraft {
    on: boolean;
    perDay: number;
}

/** A database or a rule that sets its own number, with Follow, which lets it follow the tenant again. */
function OverrideRow({ entry, tenantName, busy, onFollow }: { entry: TenantOnDemand["overrides"][number]; tenantName: string; busy: boolean; onFollow?: () => void }) {
    const Icon = entry.kind === "rule" ? Asterisk : Database;
    const off = entry.perDay === ON_DEMAND_OFF;
    return (
        <li className="flex min-w-0 items-center gap-3 px-3 py-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted/50" aria-hidden="true">
                <Icon className="size-4 text-muted-foreground" />
            </span>
            <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{entry.kind === "rule" ? <>Rule <span className="font-mono">{entry.name}</span></> : entry.name}</p>
                <p className="truncate text-xs text-muted-foreground">on {entry.serverName} · {entry.providerName}</p>
            </div>
            <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs font-medium">
                {off ? <Ban className="size-3" aria-hidden="true" /> : <Zap className="size-3" aria-hidden="true" />}
                {off ? "Off here" : `${entry.perDay} a day`}
            </span>
            {onFollow && (
                <Button type="button" variant="ghost" size="sm" className="shrink-0" disabled={busy} onClick={onFollow} aria-label={`Let ${entry.name} follow ${tenantName}`}>
                    <RotateCcw />
                    Follow {tenantName}
                </Button>
            )}
        </li>
    );
}

interface OnDemandPaneProps {
    tenant: TenantRow;
    value: OnDemandDraft;
    onChange: (next: OnDemandDraft) => void;
    disabled: boolean;
    /** May let a database or a rule follow the tenant again, which counts at once. */
    canManage: boolean;
    onChanged: () => void;
}

/**
 * Backups on demand of a customer: how many backups a day it may start of every database given to
 * it, and the databases and rules that set a number of their own instead, each with Follow.
 */
export function OnDemandPane({ tenant, value, onChange, disabled, canManage, onChanged }: OnDemandPaneProps) {
    const [overrides, setOverrides] = useState<TenantOnDemand["overrides"] | null>(null);
    const [following, setFollowing] = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            const result = await getTenantOnDemand(tenant.id);
            setOverrides(result.success ? result.data.overrides : []);
            if (!result.success) toast.error(result.error);
        } catch (error: unknown) {
            log.warn("Loading backups on demand of a tenant failed", { tenantId: tenant.id }, wrapError(error));
            setOverrides([]);
        }
    }, [tenant.id]);

    useEffect(() => {
        void load();
    }, [load]);

    const follow = async (entry: TenantOnDemand["overrides"][number]) => {
        setFollowing(entry.id);
        try {
            const result = await followTenantOnDemand(tenant.id, entry.kind, entry.id);
            if (!result.success) {
                toast.error(result.error);
                return;
            }
            toast.success(`${entry.kind === "rule" ? `The rule ${entry.name}` : entry.name} follows ${tenant.name} again`);
            await load();
            onChanged();
        } catch (error: unknown) {
            log.warn("Letting a database follow its tenant failed", { tenantId: tenant.id }, wrapError(error));
            toast.error("Backups on demand could not be changed.");
        } finally {
            setFollowing(null);
        }
    };

    const databases = overrides?.filter((entry) => entry.kind === "database").length ?? 0;
    const rules = (overrides?.length ?? 0) - databases;
    const ownCount = [databases > 0 ? `${databases} ${databases === 1 ? "database" : "databases"}` : null, rules > 0 ? `${rules} ${rules === 1 ? "rule" : "rules"}` : null].filter(Boolean).join(" and ");

    return (
        <div className="space-y-4">
            <SwitchList>
                <SwitchRow
                    title={`${tenant.name} backs up its databases itself`}
                    description="With Back up now on its Backups page, for every database given to it."
                    checked={value.on}
                    onCheckedChange={(on) => onChange({ ...value, on })}
                    disabled={disabled}
                    aside={value.on ? (
                        <span className="flex items-center gap-2 text-sm text-muted-foreground">
                            <NumberStepper
                                aria-label="Backups a day"
                                value={value.perDay}
                                onValueChange={(perDay) => onChange({ ...value, perDay })}
                                min={ON_DEMAND_MIN}
                                max={ON_DEMAND_MAX}
                                decrementLabel="Fewer a day"
                                incrementLabel="More a day"
                                disabled={disabled}
                                className="w-28"
                            />
                            a day
                        </span>
                    ) : undefined}
                />
            </SwitchList>
            <Note>Each database counts on its own, a day ends at midnight in the time zone of the instance. A database or a rule set on its own keeps its number, the others follow this one at once.</Note>

            <section className="space-y-2 border-t pt-4">
                <div className="flex items-baseline justify-between gap-3">
                    <h4 className="text-sm font-medium">Set on their own</h4>
                    {overrides && overrides.length > 0 && <span className="text-xs text-muted-foreground">{ownCount}, from the Database Explorer</span>}
                </div>
                {!overrides ? (
                    <Skeleton className="h-14 w-full" />
                ) : overrides.length === 0 ? (
                    <p className="text-sm text-muted-foreground">None. Every database given to {tenant.name} follows this number, the ones it gets later too.</p>
                ) : (
                    <>
                        <ul className="divide-y rounded-lg border">
                            {overrides.map((entry) => (
                                <OverrideRow
                                    key={`${entry.kind}-${entry.id}`}
                                    entry={entry}
                                    tenantName={tenant.name}
                                    busy={following !== null || disabled}
                                    onFollow={canManage && !entry.beyondReach ? () => void follow(entry) : undefined}
                                />
                            ))}
                        </ul>
                        <p className="text-xs text-muted-foreground">Follow counts at once. Every other database of {tenant.name} follows this number, the ones it gets later too.</p>
                    </>
                )}
            </section>
        </div>
    );
}
