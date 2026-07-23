import { redirect } from "next/navigation";
import { CONNECTION_TABS } from "@/components/adapter/connections-tabs";

/**
 * Kept so bookmarks, documentation links and anything else pointing at the old
 * Destinations page still lands somewhere useful.
 */
export default function DestinationsPage() {
    redirect(`/dashboard/connections?tab=${CONNECTION_TABS.DESTINATIONS}`);
}
