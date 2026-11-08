"use client";

import { useState } from "react";
import { Building2, Check, Globe, Info, Minus, Users } from "lucide-react";
import { AreaPane } from "@/components/permissions/permission-editor";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { accessSentences, summarizeAccess } from "@/lib/auth/access-summary";
import { LEVEL_LABELS, levelOf, TENANT_GROUP_AREAS, type PermissionArea } from "@/lib/auth/permission-areas";
import type { PlatformGroupTenant } from "@/services/user/platform-groups-types";
import { AreaButton, Eyebrow, Part, WHERE } from "./platform-group-editor";
import { ScopePane, scopeLabel, type ScopeValue } from "./platform-group-scope";

const SCOPE_TEXTS = {
    sub: "Which tenants get this group",
    all: "every new one, the home tenant included.",
    note: "Each tenant it reaches gets a group by this name that its admins give to their people. Only the platform changes, renames or deletes it, and a change counts in every tenant at once.",
};

interface TenantGroupTemplateEditorProps {
    /** Above the areas, the name of the group. */
    fields: React.ReactNode;
    name: string;
    held: ReadonlySet<string>;
    onHeldChange: (next: Set<string>) => void;
    scope: ScopeValue;
    onScopeChange: (next: ScopeValue) => void;
    tenants: readonly PlatformGroupTenant[];
    /** Why a permission may not be given, null when it may. */
    lock: (permission: string) => string | null;
    allLock: string | null;
    tenantLock: (tenantId: string) => string | null;
    /** What a tenant of the list shows on its right, like a group of its own by the name. */
    aside: (tenantId: string) => React.ReactNode;
    /** The areas, and Where, whose level changed, marked in the list. */
    changed?: ReadonlySet<string>;
    /** Everyone who holds it in any tenant. */
    members: number;
    /** The sentence under every permission of a group shown read only. */
    readOnly?: string;
}

/**
 * The editor of a group for tenants, one area at a time: on the left the name, Where and the areas
 * of a tenant, each with its level, in the middle the open area or the tenants it reaches, on the
 * right what a member can do in each of them. A phone picks the area in a `Select` and leaves the
 * summary out.
 */
export function TenantGroupTemplateEditor(props: TenantGroupTemplateEditorProps) {
    const { fields, name, held, scope, tenants, changed, members, readOnly } = props;
    const [active, setActive] = useState<string>(WHERE);
    const area = TENANT_GROUP_AREAS.find((entry) => entry.id === active);
    const scopeText = scopeLabel(scope);
    const levelIn = (entry: PermissionArea) => LEVEL_LABELS[levelOf(entry, held)];
    const eyebrow = <Eyebrow icon={Building2}>{scope.allTenants ? `In every tenant · all ${tenants.length}, new ones too` : `In the tenants · ${scopeText}`}</Eyebrow>;

    return (
        <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] md:grid-cols-[17rem_minmax(0,1fr)] md:grid-rows-1 lg:grid-cols-[17rem_minmax(0,1fr)_19rem]">
            <div className="flex min-h-0 flex-col border-b md:border-r md:border-b-0">
                <div className="space-y-4 px-3 pt-4 pb-3">{fields}</div>

                <div className="px-3 pb-4 md:hidden">
                    <Select value={active} onValueChange={setActive}>
                        <SelectTrigger aria-label="Area" className="w-full">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value={WHERE}>Where · {scopeText}</SelectItem>
                            {TENANT_GROUP_AREAS.map((entry) => <SelectItem key={entry.id} value={entry.id}>{entry.label} · {levelIn(entry)}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </div>

                <ScrollArea className="hidden min-h-0 flex-1 md:block">
                    <nav aria-label="Areas" className="space-y-3 px-3 pb-3">
                        <Part icon={Building2} title="In the tenants" note="a group in each">
                            <AreaButton label="Where" icon={scope.allTenants ? Globe : Building2} level={scopeText} on={active === WHERE} changed={changed?.has(WHERE) ?? false} onClick={() => setActive(WHERE)} />
                            <div className="mx-2 my-1 h-px bg-border" aria-hidden="true" />
                            {TENANT_GROUP_AREAS.map((entry) => (
                                <AreaButton key={entry.id} label={entry.label} level={levelIn(entry)} on={active === entry.id} changed={changed?.has(entry.id) ?? false} onClick={() => setActive(entry.id)} />
                            ))}
                        </Part>
                    </nav>
                </ScrollArea>
            </div>

            <ScrollArea className="min-h-0">
                {area ? (
                    <AreaPane
                        area={area}
                        held={held}
                        onHeldChange={props.onHeldChange}
                        lockedReason={props.lock}
                        withNeeds
                        readOnly={readOnly}
                        eyebrow={eyebrow}
                        note={(
                            <p className="flex gap-2.5 rounded-lg border bg-muted/30 p-3 text-xs">
                                <Info className="mt-px size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                                <span>What a member may do in each tenant it reaches, like with a group of that tenant.</span>
                            </p>
                        )}
                    />
                ) : (
                    <ScopePane
                        value={scope}
                        onChange={props.onScopeChange}
                        tenants={tenants}
                        allLock={props.allLock}
                        tenantLock={props.tenantLock}
                        readOnly={readOnly !== undefined}
                        eyebrow={<Eyebrow icon={Building2}>In the tenants</Eyebrow>}
                        texts={SCOPE_TEXTS}
                        aside={props.aside}
                    />
                )}
            </ScrollArea>

            <ScrollArea className="hidden min-h-0 border-l bg-muted/20 lg:block">
                <Summary name={name} held={held} scope={scope} tenants={tenants} members={members} />
            </ScrollArea>
        </div>
    );
}

/** What a member can do, in which tenants, and how the group lives in each. */
function Summary({ name, held, scope, tenants, members }: { name: string; held: ReadonlySet<string>; scope: ScopeValue; tenants: readonly PlatformGroupTenant[]; members: number }) {
    const sentences = accessSentences(summarizeAccess([...held]));
    const picked = tenants.filter((tenant) => scope.tenantIds.includes(tenant.id)).map((tenant) => tenant.name);
    const where = scope.allTenants ? `All ${tenants.length}, new ones too` : picked.length === 0 ? "No tenant yet" : picked.join(", ");
    const shown = name.trim() || "this group";
    return (
        <div className="space-y-4 p-4">
            <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">What a member of {shown} can do</p>
            <section className="space-y-1.5 border-t pt-3">
                <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                    <Building2 className="size-3.5 text-muted-foreground" aria-hidden="true" />
                    {scope.allTenants ? "In every tenant" : `In ${scopeLabel(scope).toLowerCase()}`}
                </h3>
                <p className="truncate text-xs text-muted-foreground" title={where}>{where}</p>
                <ul className="space-y-1 pt-1">
                    {held.size === 0 ? (
                        <li className="flex gap-2 text-xs text-muted-foreground"><Minus className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />Nothing yet</li>
                    ) : sentences.map((sentence) => (
                        <li key={sentence} className="flex gap-2 text-xs"><Check className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />{sentence}</li>
                    ))}
                </ul>
            </section>
            <section className="space-y-1.5 border-t pt-3">
                <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                    <Users className="size-3.5 text-muted-foreground" aria-hidden="true" />
                    In each tenant
                </h3>
                <p className="text-xs leading-relaxed text-muted-foreground">
                    A group named {shown} that its admins give to their people. Only the platform changes, renames or deletes it.
                </p>
            </section>
            <section className="space-y-1.5 border-t pt-3">
                <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Members</p>
                <p className="text-xs text-muted-foreground">
                    {members === 0 ? "Nobody yet. The admins of each tenant give it to people under Users." : `${members} ${members === 1 ? "person holds" : "people hold"} it in the tenants it reaches.`}
                </p>
            </section>
        </div>
    );
}
