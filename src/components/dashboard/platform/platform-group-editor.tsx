"use client";

import { useState } from "react";
import { Building2, ChevronRight, Globe, Info, Lock } from "lucide-react";
import { AreaPane } from "@/components/permissions/permission-editor";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LEVEL_LABELS, levelOf, PLATFORM_AREAS, PLATFORM_GROUP_TENANT_AREAS, type PermissionArea } from "@/lib/auth/permission-areas";
import { cn } from "@/lib/utils";
import type { GroupMember } from "@/services/user/groups-types";
import type { PlatformGroupTenant } from "@/services/user/platform-groups-types";
import { ScopePane, scopeLabel, type ScopeValue } from "./platform-group-scope";
import { SummaryPane } from "./platform-group-summary-pane";

/** The id of the entry Where in the list of areas, which no area takes. */
export const WHERE = "where";

interface PlatformGroupEditorProps {
    /** Above the areas, the name of the group. */
    fields: React.ReactNode;
    name: string;
    platform: ReadonlySet<string>;
    onPlatformChange: (next: Set<string>) => void;
    tenant: ReadonlySet<string>;
    onTenantChange: (next: Set<string>) => void;
    scope: ScopeValue;
    onScopeChange: (next: ScopeValue) => void;
    tenants: readonly PlatformGroupTenant[];
    /** Why a right on the platform may not be given, null when it may. */
    platformLock: (permission: string) => string | null;
    /** Why a right in the tenants may not be given, null when it may. */
    tenantLock: (permission: string) => string | null;
    allLock: string | null;
    tenantScopeLock: (tenantId: string) => string | null;
    /** The areas, and Where, whose level changed, marked in the list. */
    changed?: ReadonlySet<string>;
    members: GroupMember[];
    /** Platform admin: every area at its top, nothing to tick. */
    builtIn?: boolean;
    /** The sentence under every permission of a group shown read only. */
    readOnly?: string;
}

function AreaButton({ label, level, on, changed, icon: Icon, onClick }: { label: string; level: string; on: boolean; changed: boolean; icon?: typeof Globe; onClick: () => void }) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-current={on ? "true" : undefined}
            className={cn(
                "flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm ring-inset outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50",
                on ? "bg-tone/10 font-semibold ring-1 ring-tone/45 dark:bg-tone/15" : "font-medium hover:bg-muted/60"
            )}
        >
            {Icon && <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
            <span className="min-w-0 flex-1 truncate">{label}</span>
            {changed && <span className="size-1.5 shrink-0 rounded-full bg-tone" aria-label="changed" />}
            <span className={cn("shrink-0 text-xs font-normal", level === "None" ? "text-muted-foreground" : "text-foreground")}>{level}</span>
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
    );
}

function Part({ icon: Icon, title, note, children }: { icon: typeof Globe; title: string; note: string; children: React.ReactNode }) {
    return (
        <section className="rounded-lg border p-1">
            <h3 className="flex items-center gap-1.5 px-2 pt-1.5 pb-1 text-[11px] font-semibold tracking-wide uppercase">
                <Icon className="size-3.5 text-muted-foreground" aria-hidden="true" />
                {title}
                <span className="ml-auto truncate text-[11px] font-normal tracking-normal text-muted-foreground normal-case">{note}</span>
            </h3>
            <div className="space-y-0.5">{children}</div>
        </section>
    );
}

function Eyebrow({ icon: Icon, children }: { icon: typeof Globe; children: React.ReactNode }) {
    return (
        <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            <Icon className="size-3.5" aria-hidden="true" />
            {children}
        </p>
    );
}

/**
 * The editor of a platform group, one area at a time: on the left the name, the areas on the
 * platform and, in the tenants, Where with the tenant areas, each with its level; in the middle the
 * open area or Where; on the right what a member can do, which follows every click. A phone picks
 * the area in a `Select` and leaves the summary out.
 */
export function PlatformGroupEditor(props: PlatformGroupEditorProps) {
    const { fields, name, platform, tenant, scope, tenants, changed, members, builtIn = false, readOnly } = props;
    const [active, setActive] = useState<string>(PLATFORM_AREAS[0].id);
    const platformArea = PLATFORM_AREAS.find((area) => area.id === active);
    const tenantArea = PLATFORM_GROUP_TENANT_AREAS.find((area) => area.id === active);
    const scopeText = scopeLabel(scope);
    const tenantsEyebrow = scope.allTenants ? `In the tenants · all ${tenants.length}, new ones too` : `In the tenants · ${scopeText}`;
    const levelIn = (area: PermissionArea, held: ReadonlySet<string>) => LEVEL_LABELS[builtIn ? "full" : levelOf(area, held)];

    const note = (text: string, lock = false) => (
        <p className="flex gap-2.5 rounded-lg border bg-muted/30 p-3 text-xs">
            {lock ? <Lock className="mt-px size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" /> : <Info className="mt-px size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
            <span>{text}</span>
        </p>
    );
    const builtInNote = builtIn && note("Every right on the platform and in every tenant, also the ones a later version brings. Nobody edits or deletes this group, and at least one account always keeps it.", true);

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
                            <SelectGroup>
                                <SelectLabel>On the platform</SelectLabel>
                                {PLATFORM_AREAS.map((area) => <SelectItem key={area.id} value={area.id}>{area.label} · {levelIn(area, platform)}</SelectItem>)}
                            </SelectGroup>
                            <SelectGroup>
                                <SelectLabel>In the tenants</SelectLabel>
                                <SelectItem value={WHERE}>Where · {scopeText}</SelectItem>
                                {PLATFORM_GROUP_TENANT_AREAS.map((area) => <SelectItem key={area.id} value={area.id}>{area.label} · {levelIn(area, tenant)}</SelectItem>)}
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                </div>

                <ScrollArea className="hidden min-h-0 flex-1 md:block">
                    <nav aria-label="Areas" className="space-y-3 px-3 pb-3">
                        <Part icon={Globe} title="On the platform" note="the instance itself">
                            {PLATFORM_AREAS.map((area) => (
                                <AreaButton key={area.id} label={area.label} level={levelIn(area, platform)} on={active === area.id} changed={changed?.has(area.id) ?? false} onClick={() => setActive(area.id)} />
                            ))}
                        </Part>
                        <Part icon={Building2} title="In the tenants" note="on top of their group">
                            <AreaButton label="Where" icon={scope.allTenants ? Globe : Building2} level={scopeText} on={active === WHERE} changed={changed?.has(WHERE) ?? false} onClick={() => setActive(WHERE)} />
                            <div className="mx-2 my-1 h-px bg-border" aria-hidden="true" />
                            {PLATFORM_GROUP_TENANT_AREAS.map((area) => (
                                <AreaButton key={area.id} label={area.label} level={levelIn(area, tenant)} on={active === area.id} changed={changed?.has(area.id) ?? false} onClick={() => setActive(area.id)} />
                            ))}
                        </Part>
                    </nav>
                </ScrollArea>
            </div>

            <ScrollArea className="min-h-0">
                {platformArea ? (
                    <AreaPane
                        area={platformArea}
                        held={builtIn ? new Set(platformArea.permissions.map((permission) => permission.id)) : platform}
                        onHeldChange={props.onPlatformChange}
                        lockedReason={props.platformLock}
                        withNeeds
                        readOnly={readOnly}
                        eyebrow={<Eyebrow icon={Globe}>On the platform</Eyebrow>}
                        note={builtInNote || note("Counts on the platform itself, whichever tenant a member works in.")}
                    />
                ) : tenantArea ? (
                    <AreaPane
                        area={tenantArea}
                        held={builtIn ? new Set(tenantArea.permissions.map((permission) => permission.id)) : tenant}
                        onHeldChange={props.onTenantChange}
                        lockedReason={props.tenantLock}
                        withNeeds
                        readOnly={readOnly}
                        eyebrow={<Eyebrow icon={Building2}>{tenantsEyebrow}</Eyebrow>}
                        note={builtInNote || note("Counts in every tenant of the scope, on top of the group a member has there. It never takes away what a group of a tenant gives.")}
                    />
                ) : (
                    <ScopePane
                        value={scope}
                        onChange={props.onScopeChange}
                        tenants={tenants}
                        allLock={props.allLock}
                        tenantLock={props.tenantScopeLock}
                        readOnly={readOnly !== undefined}
                        eyebrow={<Eyebrow icon={Building2}>In the tenants</Eyebrow>}
                    />
                )}
            </ScrollArea>

            <ScrollArea className="hidden min-h-0 border-l bg-muted/20 lg:block">
                <SummaryPane name={name} platform={platform} tenant={tenant} scope={scope} tenants={tenants} members={members} builtIn={builtIn} />
            </ScrollArea>
        </div>
    );
}
