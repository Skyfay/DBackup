"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useIsMobileState } from "@/hooks/use-mobile";
import type { SettingsModel } from "@/services/system/settings-types";
import { ConfigBackupPart } from "./config-backup-part";
import { DatabasePart } from "./database-part";
import { GeneralPart } from "./general-part";
import { HttpsPart } from "./https-part";
import { NotificationsPart } from "./notifications-part";
import { PrivacyPart } from "./privacy-part";
import { RateLimitsPart } from "./rate-limits-part";
import { RecentlyDeletedPart } from "./recently-deleted-part";
import { RetentionPart } from "./retention-part";
import { SettingsFrameContext } from "./settings-frame";
import { searchSettings, settingsIndex, type SettingEntry } from "./settings-index";
import { SettingsNav, SettingsPhoneList, SettingsSearchField } from "./settings-nav";
import { partFromAddress, partOf, type SettingsPartId } from "./settings-parts";
import { SettingsResults } from "./settings-search";
import { SettingsSkeleton } from "./settings-skeleton";
import { partStates } from "./settings-states";
import { SignInPart } from "./sign-in-part";
import { TasksPart } from "./tasks-part";

/** The ring a setting the search picked shows for a moment. */
const MARK = ["ring-2", "ring-ring/60", "ring-offset-4", "ring-offset-card"];

interface SettingsClientProps {
    model: SettingsModel;
    /** The name of the viewer, as the example in the metadata of the Privacy part. */
    viewerName: string;
}

/**
 * The Settings page: its parts on the left with the state of each and a search above them, the
 * open part beside them. A phone lists the parts and opens each as a page of its own. The open
 * part lives in the address, and leaving one with unsaved changes asks first.
 */
export function SettingsClient({ model, viewerName }: SettingsClientProps) {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const isMobile = useIsMobileState();
    const addressed = partFromAddress(searchParams.get("part"), searchParams.get("tab"));
    const current: SettingsPartId = addressed ?? "general";
    const [term, setTerm] = useState("");
    const [mark, setMark] = useState<string | null>(null);
    const [openTaskId, setOpenTaskId] = useState<string | null>(null);
    const [openEventId, setOpenEventId] = useState<string | null>(null);
    const [leaving, setLeaving] = useState<(() => void) | null>(null);
    const dirty = useRef(new Set<SettingsPartId>());

    const setDirty = useCallback((part: SettingsPartId, isDirty: boolean) => {
        if (isDirty) dirty.current.add(part);
        else dirty.current.delete(part);
    }, []);
    const frame = useMemo(() => ({ readOnly: !model.canManage, setDirty }), [model.canManage, setDirty]);

    // Closing the tab or reloading with unsaved changes asks the browser's own question.
    useEffect(() => {
        const onBeforeUnload = (event: BeforeUnloadEvent) => {
            if (dirty.current.size > 0) event.preventDefault();
        };
        window.addEventListener("beforeunload", onBeforeUnload);
        return () => window.removeEventListener("beforeunload", onBeforeUnload);
    }, []);

    // A task that runs shows how it ends without a reload.
    const running = model.tasks.some((task) => task.running) || model.configBackup.running;
    useEffect(() => {
        if (!running) return;
        const timer = setInterval(() => router.refresh(), 3000);
        return () => clearInterval(timer);
    }, [running, router]);

    // The setting the search picked, marked for a moment once its part shows it.
    useEffect(() => {
        if (!mark) return;
        const frameId = requestAnimationFrame(() => {
            const element = document.querySelector<HTMLElement>(`[data-setting="${CSS.escape(mark)}"]`);
            if (!element) return;
            element.scrollIntoView({ block: "center", behavior: "smooth" });
            element.classList.add(...MARK);
            window.setTimeout(() => element.classList.remove(...MARK), 2000);
            setMark(null);
        });
        return () => cancelAnimationFrame(frameId);
    }, [mark, current]);

    const navigate = useCallback((part: SettingsPartId | null) => {
        const params = new URLSearchParams(searchParams.toString());
        params.delete("tab");
        if (part) params.set("part", part);
        else params.delete("part");
        const query = params.toString();
        router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
    }, [router, pathname, searchParams]);

    // Leaving a part with changes it has not saved asks first.
    const guarded = (go: () => void) => (dirty.current.has(current) ? setLeaving(() => go) : go());
    const open = (part: SettingsPartId) =>
        guarded(() => {
            setTerm("");
            if (part !== current || !addressed) navigate(part);
        });
    const pick = (entry: SettingEntry) =>
        guarded(() => {
            setTerm("");
            if (entry.id.startsWith("task:")) setOpenTaskId(entry.id.slice("task:".length));
            else if (entry.id.startsWith("event:")) setOpenEventId(entry.id.slice("event:".length));
            else if (entry.id !== entry.part) setMark(entry.id);
            if (entry.part !== current || !addressed) navigate(entry.part);
        });
    const clearOpenTask = useCallback(() => setOpenTaskId(null), []);
    const clearOpenEvent = useCallback(() => setOpenEventId(null), []);

    const index = useMemo(() => settingsIndex(model.tasks, model.notifications.events), [model.tasks, model.notifications.events]);
    const search = useMemo(() => searchSettings(index, term), [index, term]);
    const states = useMemo(() => partStates(model), [model]);
    const searching = term.trim().length > 0;

    if (isMobile === undefined) return <SettingsSkeleton />;

    const part = (() => {
        switch (current) {
            case "general": return <GeneralPart saved={model.general} />;
            case "tasks": return <TasksPart tasks={model.tasks} integrity={model.integrity} openTaskId={openTaskId} onOpened={clearOpenTask} onOpenPart={open} />;
            case "notifications": return <NotificationsPart model={model.notifications} openEventId={openEventId} onOpened={clearOpenEvent} />;
            case "retention": return <RetentionPart model={model.retention} />;
            case "database": return <DatabasePart info={model.database} isSuperAdmin={model.isSuperAdmin} />;
            case "config-backup": return <ConfigBackupPart model={model.configBackup} isSuperAdmin={model.isSuperAdmin} />;
            case "recently-deleted": return <RecentlyDeletedPart rows={model.trash} />;
            case "sign-in": return <SignInPart model={model.signIn} />;
            case "https": return <HttpsPart certificate={model.certificate} />;
            case "rate-limits": return <RateLimitsPart saved={model.rateLimits} />;
            case "privacy": return <PrivacyPart saved={model.privacy} viewerName={viewerName} />;
        }
    })();
    const results = <SettingsResults term={term} search={search} onPick={pick} />;

    return (
        <SettingsFrameContext.Provider value={frame}>
            {isMobile ? (
                searching || !addressed ? (
                    <div className="space-y-4">
                        <SettingsSearchField value={term} onChange={setTerm} />
                        {searching ? <div className="overflow-clip rounded-xl border bg-card shadow-sm">{results}</div> : <SettingsPhoneList states={states} onOpen={open} />}
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
                // As tall as the window at least, like a list, so a short part does not end halfway down.
                <div className="flex min-h-[calc(100svh-6.75rem)] min-w-0 overflow-clip rounded-xl border bg-card text-card-foreground shadow-sm">
                    <div className="shrink-0 border-r">
                        <div className="sticky top-4">
                            <SettingsNav current={current} states={states} term={term} onTermChange={setTerm} counts={searching ? search.counts : null} onOpen={open} />
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
                description={`${partOf(current).label} holds changes that are not saved yet.`}
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
