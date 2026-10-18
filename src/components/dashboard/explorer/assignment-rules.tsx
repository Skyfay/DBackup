"use client";

import { useMemo, useState } from "react";
import { ArrowRight, Asterisk, Database, History, MoreHorizontal, Plus, Trash2, Zap } from "lucide-react";
import { TenantTileMark } from "@/components/tenant/tenant-pick";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { DateDisplay } from "@/components/utils/date-display";
import type { RuleRow, SourceAssignments } from "@/services/tenant/database-assignments";
import { activeRules, countOf, onDemandLine, ruleGives } from "./assignment-model";
import { OnDemandNote } from "./assignment-on-demand-note";
import { OnDemandDialog } from "./assignment-on-demand-dialog";
import { RuleForm } from "./assignment-rule-form";
import { ruleLock } from "./assignment-reach";
import { RuleRemoveDialog } from "./assignment-rule-remove";

interface AssignmentRulesProps {
    serverId: string;
    serverName: string;
    data: SourceAssignments;
    canAssign: boolean;
    now: Date;
    /** How often a database changed hands this year and the last change, for the foot. */
    changes: { count: number; last: { at: number; name: string } | null };
    /** Shows the timeline of who held what. */
    onShowTimeline: () => void;
    /** Loads the card again after a change. */
    onChanged: () => void;
}

/** One rule: its pattern, the tenant it gives to, its priority and start, and what it gives now. */
function RuleItem({ rule, gives, canAssign, onRemove, onOnDemand }: { rule: RuleRow; gives: string[]; canAssign: boolean; onRemove: () => void; onOnDemand: () => void }) {
    return (
        <li className="space-y-2 border-t px-5 py-3.5">
            <div className="flex min-w-0 items-center gap-2">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-md border bg-muted/50" aria-hidden="true">
                    <Asterisk className="size-4 text-muted-foreground" />
                </span>
                <span className="min-w-0 truncate font-mono text-sm font-medium">{rule.pattern}</span>
                <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="inline-flex min-w-0 items-center gap-1.5 rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium">
                    <TenantTileMark name={rule.tenantName} className="size-4 rounded-sm border-0 bg-transparent text-[8px]" />
                    <span className="truncate">{rule.tenantName}</span>
                </span>
                {canAssign && (
                    <DropdownMenu modal={false}>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" className="ml-auto size-8 shrink-0 p-0">
                                <MoreHorizontal />
                                <span className="sr-only">Open menu for the rule {rule.pattern}</span>
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-52">
                            <DropdownMenuItem tone="edit" onSelect={onOnDemand}><Zap /> Backups on demand</DropdownMenuItem>
                            <DropdownMenuItem variant="destructive" tone="destructive" onSelect={onRemove}><Trash2 /> Remove rule</DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                )}
            </div>
            <p className="text-xs text-muted-foreground tabular-nums">
                Priority {rule.priority} · from <DateDisplay date={rule.validFrom} format="P" />
            </p>
            <OnDemandNote line={onDemandLine(rule.onDemandPerDay, rule.tenantOnDemand, rule.tenantName)} />
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="text-muted-foreground">Gives now</span>
                {gives.length === 0 ? (
                    <span className="text-muted-foreground">no database</span>
                ) : (
                    gives.map((name) => (
                        <span key={name} className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 font-medium">
                            <Database className="size-3 text-muted-foreground" aria-hidden="true" />
                            {name}
                        </span>
                    ))
                )}
            </div>
        </li>
    );
}

/**
 * The rules of names beside the databases: each gives every database whose name matches to one
 * tenant, also the ones the server gets later. New rule opens a form on top with a preview of
 * what it would give. The foot counts the changes of this year and leads to who held what.
 */
export function AssignmentRules({ serverId, serverName, data, canAssign, now, changes, onShowTimeline, onChanged }: AssignmentRulesProps) {
    const [adding, setAdding] = useState(false);
    const [removing, setRemoving] = useState<RuleRow | null>(null);
    const [onDemand, setOnDemand] = useState<RuleRow | null>(null);
    const gives = useMemo(() => ruleGives(data, now), [data, now]);
    // An ended rule only decides the backups of its time, the timeline shows it.
    const rules = useMemo(() => activeRules(data.rules), [data.rules]);

    return (
        <section aria-label="Rules" className="min-w-0 overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm">
            <div className="flex items-start gap-3 px-5 pt-4 pb-3">
                <div className="min-w-0 flex-1">
                    <h3 className="font-semibold">Rules</h3>
                    <p className="text-sm text-muted-foreground">Give every database whose name matches, also the ones the server gets later. The higher priority wins, a database given by name beats every rule.</p>
                </div>
                {canAssign && data.customers.length > 0 && !adding && (
                    <Button tone="create" variant="outline" size="sm" onClick={() => setAdding(true)} className="shrink-0">
                        <Plus />
                        New rule
                    </Button>
                )}
            </div>
            {adding && (
                <div className="px-5 pb-4">
                    <RuleForm
                        serverId={serverId}
                        serverName={serverName}
                        data={data}
                        onCancel={() => setAdding(false)}
                        onAdded={() => {
                            setAdding(false);
                            onChanged();
                        }}
                    />
                </div>
            )}
            {rules.length === 0 ? (
                <p className="border-t px-5 py-5 text-sm text-muted-foreground">No rule yet. A rule like shop_* gives every database whose name starts with shop_ to one tenant.</p>
            ) : (
                <ul>
                    {rules.map((rule) => (
                        // A rule of a tenant beyond the reach of the viewer stays as it is.
                        <RuleItem key={rule.id} rule={rule} gives={gives.get(rule.id) ?? []} canAssign={canAssign && !ruleLock(rule, data)} onRemove={() => setRemoving(rule)} onOnDemand={() => setOnDemand(rule)} />
                    ))}
                </ul>
            )}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t bg-page/60 px-5 py-2.5 text-xs text-muted-foreground">
                <History className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                    <span className="font-medium text-foreground">{countOf(changes.count, "change")} this year</span>
                    {changes.last && <>, the last on <DateDisplay date={new Date(changes.last.at)} format="P" /> for {changes.last.name}</>}
                </span>
                <Button variant="ghost" size="sm" className="h-7 px-2" onClick={onShowTimeline}>
                    <ArrowRight />
                    Who held what
                </Button>
            </div>
            {onDemand && (
                <OnDemandDialog
                    serverId={serverId}
                    serverName={serverName}
                    target={{ kind: "rule", ruleId: onDemand.id, pattern: onDemand.pattern, tenantName: onDemand.tenantName, perDay: onDemand.onDemandPerDay, tenantPerDay: onDemand.tenantOnDemand }}
                    onClose={() => setOnDemand(null)}
                    onSaved={() => {
                        setOnDemand(null);
                        onChanged();
                    }}
                />
            )}
            {removing && (
                <RuleRemoveDialog
                    serverId={serverId}
                    rule={removing}
                    data={data}
                    onClose={() => setRemoving(null)}
                    onRemoved={() => {
                        setRemoving(null);
                        onChanged();
                    }}
                />
            )}
        </section>
    );
}
