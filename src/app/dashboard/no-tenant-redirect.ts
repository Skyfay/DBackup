import { redirect } from "next/navigation";
import { getViewer } from "@/lib/auth/access-control";

/**
 * Sends an account that works in no tenant, outside All tenants, from a page of tenant records to
 * the Overview, which tells it why. Every query of such a page would refuse it and show the error
 * page instead, like for someone whose group an upgrade took away and who opens a bookmark. Called
 * before the page loads anything else.
 */
export async function redirectWithoutTenant(): Promise<void> {
    const viewer = await getViewer();
    if (viewer && !viewer.tenantId && !viewer.allTenants) redirect("/dashboard");
}
