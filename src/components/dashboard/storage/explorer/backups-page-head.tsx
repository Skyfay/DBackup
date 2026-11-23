"use client";

import { Archive, HardDrive } from "lucide-react";
import { PageHead } from "@/components/ui/page-head";
import { PageTabs, type PageTab } from "@/components/ui/page-tabs";
import { Tabs } from "@/components/ui/tabs";
import { ViewSwitch } from "@/components/ui/view-switch";
import type { ViewMode } from "@/lib/core/table-preferences";
import type { ExplorerDestination, ExplorerJob } from "@/services/storage/explorer-types";
import { backupsAttention, destinationsAttention } from "./destination-model";
import { FreshnessButton } from "./freshness-button";
import type { ExplorerTab } from "./use-explorer-address";

interface BackupsPageHeadProps {
    tab: ExplorerTab;
    onTab: (tab: string) => void;
    jobs: ExplorerJob[];
    destinations: ExplorerDestination[];
    /** The destinations whose lists the open list shows, for how fresh they are. */
    freshness: ExplorerDestination[];
    onCheckNow: () => Promise<void>;
    view: ViewMode;
    views: ViewMode[];
    onView: (view: ViewMode) => void;
}

/**
 * The head of the Backups page: its lists as tabs, and on their right how fresh the lists of the
 * destinations are and the switch of the view. The backups of shared databases sit in the list of
 * the Backups tab, so they have no tab of their own.
 */
export function BackupsPageHead({ tab, onTab, jobs, destinations, freshness, onCheckNow, view, views, onView }: BackupsPageHeadProps) {
    const tabs: PageTab[] = [
        { value: "backups", label: "Backups", icon: Archive, attention: backupsAttention(jobs) },
        { value: "destinations", label: "Destinations", icon: HardDrive, attention: destinationsAttention(destinations) },
    ];
    return (
        <PageHead>
            <Tabs value={tab} onValueChange={onTab} className="min-w-0 flex-1">
                <PageTabs tabs={tabs} value={tab} onValueChange={onTab} label="Backup list" />
            </Tabs>
            <div className="ml-auto flex shrink-0 items-center gap-2">
                <FreshnessButton destinations={freshness} onCheckNow={onCheckNow} />
                {/* Hidden by CSS rather than by the measured screen, so it does not pop in after loading. */}
                <div className="hidden md:block">
                    <ViewSwitch value={view} onChange={onView} views={views} />
                </div>
            </div>
        </PageHead>
    );
}
