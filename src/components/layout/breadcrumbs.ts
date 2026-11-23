/**
 * The trail of the header bar as plain data: a step per part of the address, named for people.
 * Inside a tenant of several it starts with the tenant, like "Acme GmbH > Jobs". The pages of
 * Platform belong to no tenant, so their trail starts with Platform, which has no page of its own.
 */

export interface Crumb {
    name: string;
    /** Where the step leads, null for a step without a page of its own. */
    href: string | null;
    /** The step Platform, which the header marks apart. */
    platform?: boolean;
}

const SEGMENT_NAMES: Record<string, string> = {
    "users": "Users & Groups",
    "setup": "Quick Setup",
    "explorer": "Database Explorer",
    "tenants": "Tenants",
    "platform": "Platform",
};

/** The steps that have no page, which the trail shows without a link. */
const WITHOUT_PAGE = new Set(["/dashboard/platform"]);

const named = (segment: string) => SEGMENT_NAMES[segment] || segment.charAt(0).toUpperCase() + segment.slice(1);

/** The trail of a page, with the tenant it starts with inside a tenant of several, null otherwise. */
export function breadcrumbs(pathname: string, tenantName: string | null | undefined): Crumb[] {
    const segments = pathname.split("/").filter(Boolean);
    const platform = segments[0] === "dashboard" && segments[1] === "platform";
    return segments.flatMap((segment, index): Crumb[] => {
        // The platform is no tenant, so its pages leave out where the viewer works.
        if (platform && index === 0) return [];
        const href = `/${segments.slice(0, index + 1).join("/")}`;
        const name = index === 0 && segment === "dashboard" && tenantName ? tenantName : named(segment);
        return [{ name, href: WITHOUT_PAGE.has(href) ? null : href, ...(platform && index === 1 ? { platform: true } : {}) }];
    });
}
