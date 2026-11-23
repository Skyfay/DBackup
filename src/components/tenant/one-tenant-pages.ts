/**
 * The pages of what belongs to one tenant, like the Vault, which All tenants cannot show. Their
 * entry in the sidebar asks for the tenant first, and an address of one opened in All tenants asks
 * the same on the page.
 */
export interface OneTenantPage {
    path: string;
    /** The title of the pick, the name of the page. */
    title: string;
    /** Why it asks, one line under the title. */
    description: string;
}

export const ONE_TENANT_PAGES: readonly OneTenantPage[] = [
    { path: "/dashboard/setup", title: "Quick Setup", description: "It sets up the backups of one tenant, pick the one they belong to." },
    { path: "/dashboard/vault", title: "Vault", description: "The keys and logins belong to one tenant, pick the one to open." },
    { path: "/dashboard/templates", title: "Templates", description: "Every tenant has templates of its own, pick the one to open." },
    { path: "/dashboard/users", title: "Users & Groups", description: "Members, groups, API keys and the audit log belong to one tenant, pick the one to open." },
    { path: "/dashboard/settings", title: "Settings", description: "The name, the logo, the notifications and Recently deleted belong to one tenant, pick the one to open." },
];

/** The page of one tenant at an address, its sub-pages included, null for any other. */
export function oneTenantPage(href: string): OneTenantPage | null {
    const path = new URL(href, "http://dbackup.invalid").pathname;
    return ONE_TENANT_PAGES.find((page) => path === page.path || path.startsWith(`${page.path}/`)) ?? null;
}
