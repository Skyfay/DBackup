import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { withQuery, type PageSearchParams } from "../search-params";

/** The name of the browser tab, which the root layout ends with the name of the instance. */
export const metadata: Metadata = { title: "Tenants" };

/** The Tenants page moved under Platform. An old link, like `?open=<id>` to a tenant, still lands there. */
export default async function OldTenantsPage({ searchParams }: { searchParams: Promise<PageSearchParams> }) {
    redirect(withQuery("/dashboard/platform/tenants", await searchParams));
}
