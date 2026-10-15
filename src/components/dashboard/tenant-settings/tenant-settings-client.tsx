"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { RecentlyDeletedFrame } from "@/components/dashboard/settings/recently-deleted-frame";
import { SettingsFrameContext } from "@/components/dashboard/settings/settings-frame";
import { searchSettings, type SettingEntry } from "@/components/dashboard/settings/settings-index";
import { RAIL_STICKY, SettingsNav, SettingsPhoneList, SettingsSearchField } from "@/components/dashboard/settings/settings-nav";
import { SettingsResults } from "@/components/dashboard/settings/settings-search";
import { SettingsSkeleton } from "@/components/dashboard/settings/settings-skeleton";
import { TenantTileMark } from "@/components/tenant/tenant-pick";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useIsMobileState } from "@/hooks/use-mobile";
import type { TenantSettingsModel } from "@/services/tenant/tenant-settings-model";
import { TenantNotificationsPart } from "./tenant-notifications-part";
import { TenantProfilePart } from "./tenant-profile-part";
import { TENANT_SETTINGS_PART_IDS, tenantPartFromAddress, tenantPartOf, tenantPartStates, tenantSettingsGroups, tenantSettingsIndex, type TenantSettingsPartId } from "./tenant-settings-parts";

/** The ring a setting the search picked shows for a moment. */
const MARK = ["ring-2", "ring-ring/60", "ring-offset-4", "ring-offset-card"];

/** The tenant above the parts, so the page says whose settings these are. */
function RailHead({ model }: { model: TenantSettingsModel }) {
    return (
        <div className="flex w-64 min-w-0 items-center gap-3 px-3 pt-4 lg:w-72">
            <TenantTileMark name={model.tenant.name} logo={model.tenant.logo?.url ?? null} className="size-9 rounded-lg text-xs" />
            <div className="min-w-0 leading-tight">
                <p className="truncate text-sm font-semibold">Tenant settings</p>
                <p className="truncate text-xs text-muted-foreground">{model.tenant.name}, only this tenant</p>
            </div>
        </div>
    );
}

/**
 * Settings under Administration with more than one tenant: the name and logo of the open tenant,
 * where its own events go and Recently deleted, in the frame of the Settings page. A phone lists
 * the parts and opens each as a page of its own. The open part lives in the address, and leaving
 * one with unsaved changes asks first.
 */
export function TenantSettingsClient({ model }: { model: TenantSettingsModel }) {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const isMobile = useIsMobileState();
    const addressed = tenantPartFromAddress(searchParams.get("part"));
    const current: TenantSettingsPartId = addressed ?? "profile";
    const [term, setTerm] = useState("");
    const [mark, setMark] = useState<string | null>(null);
    const [openEventId, setOpenEventId] = useState<string | null>(null);
    const [leaving, setLeaving] = useState<(() => void) | null>(null);
    const dirty = useRef(new Set<string>());

    const setDirty = useCallback((part: string, isDirty: boolean) => {
        if (isDirty) dirty.current.add(part);
        else dirty.current.delete(part);
    }, []);
    const frame = useMemo(() => ({
        readOnly: !model.canManage,
        setDirty,
        describe: tenantPartOf,
        readOnlyNote: "You may look at the settings of the tenant. Changing them needs a group that may change the tenant settings.",
    }), [model.canManage, setDirty]);

    // Closing the tab or reloading with unsaved changes asks the browser's own question.
    useEffect(() => {
        const onBeforeUnload = (event: BeforeUnloadEvent) => {
            if (dirty.current.size > 0) event.preventDefault();
        };
        window.addEventListener("beforeunload", onBeforeUnload);
        return () => window.removeEventListener("beforeunload", onBeforeUnload);
    }, []);

    // The setting the search picked, marked for a moment once its part shows it.
    useEffect(() => {
        if (!mark) return;
        const frameId = requestAnimationFrame(() => {
            const element = document.querySelector<HTMLElement>(`[data-setting="${CSS.escape(mark)}"]`);
            setMark(null);
            if (!element) return;
            element.scrollIntoView({ block: "center", behavior: "smooth" });
            element.classList.add(...MARK);
            window.setTimeout(() => element.classList.remove(...MARK), 2000);
        });
        return () => cancelAnimationFrame(frameId);
    }, [mark, current]);

    const navigate = useCallback((part: TenantSettingsPartId | null) => {
        const params = new URLSearchParams(searchParams.toString());
        if (part) params.set("part", part);
        else params.delete("part");
        const query = params.toString();
        router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
    }, [router, pathname, searchParams]);

    // Leaving a part with changes it has not saved asks first.
    const guarded = (go: () => void) => (dirty.current.has(current) ? setLeaving(() => go) : go());
    const open = (part: TenantSettingsPartId) =>
        guarded(() => {
            setTerm("");
            if (part !== current || !addressed) navigate(part);
        });
    const pick = (entry: SettingEntry<TenantSettingsPartId>) =>
        guarded(() => {
            setTerm("");
            if (entry.id.startsWith("event:")) setOpenEventId(entry.id.slice("event:".length));
            else if (entry.id !== entry.part) setMark(entry.id);
            if (entry.part !== current || !addressed) navigate(entry.part);
        });
    const clearOpenEvent = useCallback(() => setOpenEventId(null), []);

    const groups = useMemo(() => tenantSettingsGroups(model.tenant.name), [model.tenant.name]);
    const index = useMemo(() => tenantSettingsIndex(), []);
    const search = useMemo(() => searchSettings(index, term, TENANT_SETTINGS_PART_IDS), [index, term]);
    const states = useMemo(() => tenantPartStates(model), [model]);
    const searching = term.trim().length > 0;

    if (isMobile === undefined) return <SettingsSkeleton />;

    const part = (() => {
        switch (current) {
            case "profile": return <TenantProfilePart model={model} />;
            case "tenant-notifications": return <TenantNotificationsPart model={model} openEventId={openEventId} onOpened={clearOpenEvent} />;
            case "recently-deleted": return <RecentlyDeletedFrame trash={model.trash} />;
        }
    })();
    const results = <SettingsResults term={term} search={search} onPick={pick} describe={tenantPartOf} where="the tenant settings" />;

    return (
        <SettingsFrameContext.Provider value={frame}>
            {isMobile ? (
                searching || !addressed ? (
                    <div className="space-y-4">
                        <SettingsSearchField value={term} onChange={setTerm} placeholder="Search the tenant settings" />
                        {searching ? <div className="overflow-clip rounded-xl border bg-card shadow-sm">{results}</div> : <SettingsPhoneList groups={groups} states={states} onOpen={open} />}
                    </div>
                ) : (
                    <div className="space-y-3">
                        <Button variant="ghost" size="sm" className="-ml-2" onClick={() => guarded(() => navigate(null))}>
                            <ArrowLeft />
                            Settings
                        </Button>
                        <div className="flex min-h-[calc(100svh-9.25rem)] flex-col overflow-clip rounded-xl border bg-card text-card-foreground shadow-sm">{part}</div>
                    </div>
                )
            ) : (
                // As tall as the window at least, like Settings, so a short part does not end halfway down.
                <div className="flex min-h-[calc(100svh-6.75rem)] min-w-0 overflow-clip rounded-xl border bg-card text-card-foreground shadow-sm">
                    <div className="shrink-0 border-r">
                        <div className={RAIL_STICKY}>
                            <RailHead model={model} />
                            <SettingsNav
                                groups={groups}
                                label="Tenant settings"
                                searchPlaceholder="Search the tenant settings"
                                current={current}
                                states={states}
                                term={term}
                                onTermChange={setTerm}
                                counts={searching ? search.counts : null}
                                onOpen={open}
                            />
                        </div>
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col">{searching ? results : part}</div>
                </div>
            )}

            <ConfirmDialog
                open={leaving !== null}
                onOpenChange={(next) => !next && setLeaving(null)}
                title="Leave without saving?"
                note="The changes are lost"
                description={`${tenantPartOf(current).label} holds changes that are not saved yet.`}
                tone="warning"
                confirmLabel="Discard and leave"
                onConfirm={() => {
                    const go = leaving;
                    dirty.current.delete(current);
                    setLeaving(null);
                    go?.();
                }}
            />
        </SettingsFrameContext.Provider>
    );
}
