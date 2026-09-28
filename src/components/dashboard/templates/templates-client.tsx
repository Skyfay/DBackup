"use client";

import { useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useIsMobileState } from "@/hooks/use-mobile";
import type { TablePreferences } from "@/lib/core/table-preferences";
import type { TemplateCounts } from "@/services/templates/templates-types";
import { ExcludeTab } from "./exclude-tab";
import { NamingTab } from "./naming-tab";
import { NotificationTab } from "./notification-tab";
import { RetentionTab } from "./retention-tab";
import { ScheduleTab } from "./schedule-tab";
import type { TemplateTabHandle, TemplateTabProps } from "./template-tab-props";
import { TEMPLATE_TABLE_IDS, TEMPLATE_TABS, type TemplateTab } from "./template-tables";
import { useTemplatesModel } from "./use-templates-model";

const LABELS: Record<TemplateTab, string> = {
    retention: "Retention policies",
    naming: "File names",
    schedules: "Schedule presets",
    notifications: "Notifications",
    excludes: "Exclude patterns",
};

const NEW: Record<TemplateTab, string> = {
    retention: "New policy",
    naming: "New template",
    schedules: "New preset",
    notifications: "New template",
    excludes: "New preset",
};

const TABS: Record<TemplateTab, (props: TemplateTabProps) => React.ReactNode> = {
    retention: RetentionTab,
    naming: NamingTab,
    schedules: ScheduleTab,
    notifications: NotificationTab,
    excludes: ExcludeTab,
};

interface TemplatesClientProps {
    counts: TemplateCounts;
    layouts: Record<string, TablePreferences>;
    /** May add, change and delete templates, not only look at them. */
    canManage: boolean;
}

function Count({ value }: { value: number }) {
    return <span className="text-xs font-normal text-muted-foreground tabular-nums">{value.toLocaleString()}</span>;
}

/**
 * The Templates page: retention policies, file names, schedule presets, notifications and exclude
 * patterns, each a list with what uses every template. The tab lives in the address, New beside
 * the tabs belongs to the open one, and a phone gets cards.
 */
export function TemplatesClient({ counts, layouts, canManage }: TemplatesClientProps) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const isMobile = useIsMobileState();
    const { model, isLoading, refresh } = useTemplatesModel();
    const handles = useRef<Partial<Record<TemplateTab, TemplateTabHandle | null>>>({});

    const requested = searchParams.get("tab") as TemplateTab | null;
    const active = requested && TEMPLATE_TABS.includes(requested) ? requested : "retention";

    const setTab = useCallback((value: string) => {
        const next = new URLSearchParams(searchParams.toString());
        next.set("tab", value);
        // Replace rather than push, switching tabs should not fill the back button.
        router.replace(`?${next.toString()}`, { scroll: false });
    }, [router, searchParams]);

    // The counts beside the tabs come from the server first, then from the loaded templates.
    const afterChange = useCallback(() => {
        void refresh();
        router.refresh();
    }, [refresh, router]);
    const live: TemplateCounts = model
        ? { retention: model.retention.length, naming: model.naming.length, schedules: model.schedules.length, notifications: model.notifications.length, excludes: model.excludes.length }
        : counts;

    return (
        <Tabs value={active} onValueChange={setTab} className="w-full gap-4 md:gap-6">
            <div className="flex items-center gap-2 md:gap-3">
                {/* A phone picks the list from a menu, five tabs never fit next to New. Both are hidden
                    by CSS rather than by the measured screen, so neither pops in. */}
                <div className="min-w-0 flex-1 md:hidden">
                    <Select value={active} onValueChange={setTab}>
                        <SelectTrigger className="w-full" aria-label="Template list">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {TEMPLATE_TABS.map((tab) => (
                                <SelectItem key={tab} value={tab}>
                                    <span className="flex items-center gap-2">{LABELS[tab]}<Count value={live[tab]} /></span>
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                {/* From a tablet up they stay tabs, and scroll sideways when they outgrow the row. */}
                <ScrollArea horizontal className="hidden min-w-0 md:block">
                    <TabsList aria-label="Show">
                        {TEMPLATE_TABS.map((tab) => (
                            <TabsTrigger key={tab} value={tab}>
                                <span className="flex items-center gap-2">{LABELS[tab]}<Count value={live[tab]} /></span>
                            </TabsTrigger>
                        ))}
                    </TabsList>
                </ScrollArea>
                {canManage && (
                    <Button tone="create" className="ml-auto shrink-0" onClick={() => handles.current[active]?.openCreate()} aria-label={NEW[active]}>
                        <Plus />
                        <span className="hidden sm:inline">{NEW[active]}</span>
                    </Button>
                )}
            </div>

            {/* Waits for the measured screen, so a phone never flashes the table before its cards. */}
            {isMobile !== undefined &&
                TEMPLATE_TABS.map((tab) => {
                    const Tab = TABS[tab];
                    return (
                        <TabsContent key={tab} value={tab}>
                            <Tab
                                ref={(handle: TemplateTabHandle | null) => {
                                    handles.current[tab] = handle;
                                }}
                                model={model}
                                isLoading={isLoading}
                                refresh={refresh}
                                afterChange={afterChange}
                                cards={isMobile}
                                canManage={canManage}
                                initialLayout={layouts[TEMPLATE_TABLE_IDS[tab]] ?? null}
                            />
                        </TabsContent>
                    );
                })}
        </Tabs>
    );
}
