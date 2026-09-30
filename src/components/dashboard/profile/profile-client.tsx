"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTheme } from "next-themes";
import { ArrowLeft } from "lucide-react";
import { SettingsFrameContext } from "@/components/dashboard/settings/settings-frame";
import { searchSettings, type SettingEntry } from "@/components/dashboard/settings/settings-index";
import { SettingsNav, SettingsPhoneList, SettingsSearchField } from "@/components/dashboard/settings/settings-nav";
import { SettingsResults } from "@/components/dashboard/settings/settings-search";
import { SettingsSkeleton } from "@/components/dashboard/settings/settings-skeleton";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useTableDefaults } from "@/components/ui/table-defaults";
import { useIsMobileState } from "@/hooks/use-mobile";
import type { ProfileModel } from "@/services/user/profile-model";
import { AccountPart } from "./account-part";
import { AppearancePart } from "./appearance-part";
import { ColorsPart } from "./colors-part";
import { DatesPart } from "./dates-part";
import { profileIndex } from "./profile-index";
import { PROFILE_GROUPS, PROFILE_PARTS, profilePartFromAddress, profilePartOf, type ProfilePartId } from "./profile-parts";
import { profileStates } from "./profile-states";
import { RunsPart } from "./runs-part";
import { SecurityPart } from "./security-part";
import { SessionsPart } from "./sessions-part";
import { TablesPart } from "./tables-part";

/** The ring a setting the search picked shows for a moment. */
const MARK = ["ring-2", "ring-ring/60", "ring-offset-4", "ring-offset-card"];

const PART_IDS = PROFILE_PARTS.map((part) => part.id);

/**
 * The Profile page, built like Settings: its parts on the left with the state of each and a search
 * above them, the open part beside them. A phone lists the parts and opens each as a page of its
 * own. The open part lives in the address, and leaving one with unsaved changes asks first.
 */
export function ProfileClient({ model }: { model: ProfileModel }) {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const isMobile = useIsMobileState();
    const { theme } = useTheme();
    const tables = useTableDefaults();
    const addressed = profilePartFromAddress(searchParams.get("part"), searchParams.get("tab"));
    const current: ProfilePartId = addressed ?? "account";
    const [term, setTerm] = useState("");
    const [mark, setMark] = useState<string | null>(null);
    const [leaving, setLeaving] = useState<(() => void) | null>(null);
    const dirty = useRef(new Set<string>());

    const setDirty = useCallback((part: string, isDirty: boolean) => {
        if (isDirty) dirty.current.add(part);
        else dirty.current.delete(part);
    }, []);
    // Every part is the viewer's own, so none is read-only as a whole. A field the group may not change says so itself.
    const frame = useMemo(() => ({ readOnly: false, setDirty, describe: profilePartOf }), [setDirty]);

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

    const navigate = useCallback((part: ProfilePartId | null) => {
        const params = new URLSearchParams(searchParams.toString());
        params.delete("tab");
        if (part) params.set("part", part);
        else params.delete("part");
        const query = params.toString();
        router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
    }, [router, pathname, searchParams]);

    // Leaving a part with changes it has not saved asks first.
    const guarded = (go: () => void) => (dirty.current.has(current) ? setLeaving(() => go) : go());
    const open = (part: ProfilePartId) =>
        guarded(() => {
            setTerm("");
            if (part !== current || !addressed) navigate(part);
        });
    const pick = (entry: SettingEntry<ProfilePartId>) =>
        guarded(() => {
            setTerm("");
            if (entry.id !== entry.part) setMark(entry.id);
            if (entry.part !== current || !addressed) navigate(entry.part);
        });

    const index = useMemo(() => profileIndex(), []);
    const search = useMemo(() => searchSettings(index, term, PART_IDS), [index, term]);
    const states = useMemo(() => profileStates(model, { theme, colors: model.colors, tables }), [model, theme, tables]);
    const searching = term.trim().length > 0;

    if (isMobile === undefined) return <SettingsSkeleton />;

    const part = (() => {
        switch (current) {
            case "account": return <AccountPart model={model} />;
            case "security": return <SecurityPart model={model} />;
            case "sessions": return <SessionsPart />;
            case "appearance": return <AppearancePart />;
            case "colors": return <ColorsPart saved={model.colors} />;
            case "dates": return <DatesPart user={model.user} />;
            case "tables": return <TablesPart saved={tables} />;
            case "runs": return <RunsPart user={model.user} />;
        }
    })();
    const results = <SettingsResults term={term} search={search} onPick={pick} describe={profilePartOf} where="your profile" />;

    return (
        <SettingsFrameContext.Provider value={frame}>
            {isMobile ? (
                searching || !addressed ? (
                    <div className="space-y-4">
                        <SettingsSearchField value={term} onChange={setTerm} placeholder="Search your profile" />
                        {searching ? <div className="overflow-clip rounded-xl border bg-card shadow-sm">{results}</div> : <SettingsPhoneList groups={PROFILE_GROUPS} states={states} onOpen={open} />}
                    </div>
                ) : (
                    <div className="space-y-3">
                        <Button variant="ghost" size="sm" className="-ml-2" onClick={() => guarded(() => navigate(null))}>
                            <ArrowLeft />
                            Profile
                        </Button>
                        <div className="flex min-h-[calc(100svh-9.25rem)] flex-col overflow-clip rounded-xl border bg-card text-card-foreground shadow-sm">{part}</div>
                    </div>
                )
            ) : (
                // As tall as the window at least, like Settings, so a short part does not end halfway down.
                <div className="flex min-h-[calc(100svh-6.75rem)] min-w-0 overflow-clip rounded-xl border bg-card text-card-foreground shadow-sm">
                    <div className="shrink-0 border-r">
                        <div className="sticky top-4">
                            <SettingsNav
                                groups={PROFILE_GROUPS}
                                label="Profile"
                                searchPlaceholder="Search your profile"
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
                description={`${profilePartOf(current).label} holds changes that are not saved yet.`}
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
