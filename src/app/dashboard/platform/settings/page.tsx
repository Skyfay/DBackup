import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { platformSettingsRoute } from "@/components/dashboard/settings/settings-address";
import { tenantService } from "@/services/tenant/tenant-service";
import { firstOf, queryOf, type PageSearchParams } from "../../search-params";
import { PlatformSettingsView } from "./platform-settings-view";

/** The name of the browser tab, which the root layout ends with the name of the instance. */
export const metadata: Metadata = { title: "Platform settings" };

/**
 * Platform settings: the settings of the instance, which count for every tenant, with more than
 * one tenant. With one they stay at Settings, where this address leads.
 */
export default async function PlatformSettingsPage({ searchParams }: { searchParams: Promise<PageSearchParams> }) {
    const params = await searchParams;
    const tenantCount = await tenantService.count();
    const route = platformSettingsRoute({ several: tenantCount > 1, part: firstOf(params, "part"), query: queryOf(params) });
    if (route.kind === "redirect") redirect(route.to);
    return <PlatformSettingsView tenantCount={tenantCount} />;
}
