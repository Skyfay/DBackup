"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHead } from "@/components/ui/page-head";
import { PageTabs } from "@/components/ui/page-tabs";
import { Tabs } from "@/components/ui/tabs";
import { useIsMobileState } from "@/hooks/use-mobile";
import { NotificationsTab } from "./notifications-tab";
import { RunsTab, type RunsAccess } from "./runs-tab";

type HistoryTab = "runs" | "notifications";

/**
 * The History page: every run of DBackup, backups, restores and the system tasks, and every
 * notification it sent. The tab lives in the address, a phone gets cards.
 */
export function HistoryClient({ access }: { access: RunsAccess }) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const tab: HistoryTab = searchParams.get("tab") === "notifications" ? "notifications" : "runs";
    const isMobile = useIsMobileState();
    const [counts, setCounts] = useState<{ runs: number; notifications: number } | null>(null);

    useEffect(() => {
        let cancelled = false;
        void fetch("/api/history/counts")
            .then((response) => (response.ok ? response.json() : null))
            .then((body) => { if (!cancelled && body?.success) setCounts(body.data); })
            .catch(() => undefined);
        return () => { cancelled = true; };
    }, []);

    const setTab = (next: HistoryTab) => router.replace(next === "notifications" ? "/dashboard/history?tab=notifications" : "/dashboard/history", { scroll: false });

    return (
        <div className="space-y-4 md:space-y-0">
            <PageHead>
                <Tabs value={tab} onValueChange={(value) => setTab(value as HistoryTab)} className="min-w-0 flex-1">
                    <PageTabs
                        tabs={[{ value: "runs", label: "Runs", count: counts?.runs }, { value: "notifications", label: "Notifications", count: counts?.notifications }]}
                        value={tab}
                        onValueChange={(value) => setTab(value as HistoryTab)}
                        label="History list"
                    />
                </Tabs>
            </PageHead>
            {/* Waits for the measured screen, so a phone never flashes the table before its cards. */}
            {isMobile === undefined ? null : tab === "runs" ? <RunsTab cards={isMobile} access={access} /> : <NotificationsTab cards={isMobile} />}
        </div>
    );
}
