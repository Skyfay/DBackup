import { redirect } from "next/navigation";
import { CONNECTION_TABS } from "@/components/adapter/connections-tabs";

/**
 * Kept so bookmarks, documentation links and anything else pointing at the old
 * Notifications page still lands somewhere useful.
 */
export default function NotificationsPage() {
    redirect(`/dashboard/connections?tab=${CONNECTION_TABS.NOTIFICATIONS}`);
}
