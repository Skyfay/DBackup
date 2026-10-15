import { isTenantPart, partFromAddress } from "./settings-parts";

/**
 * Where an address of the settings leads, as plain rules. With one tenant Settings is the Settings
 * of the instance, as before tenants, at `/dashboard/settings`, with Recently deleted among its
 * parts. With more, that address holds the settings of the open tenant, Recently deleted included,
 * and the instance's are Platform settings. An old link to a part of either, or to a part that
 * became a page, still lands on it.
 */

export type SettingsRoute = { kind: "redirect"; to: string } | { kind: "platform" } | { kind: "tenant" };

const TENANTS = "/dashboard/platform/tenants";

/** The parts that became pages of their own. */
function movedPage(part: string | null): string | null {
    return part === "tenants" ? TENANTS : null;
}

const withQuery = (path: string, query: string) => (query ? `${path}?${query}` : path);

/** What `/dashboard/settings` shows: the settings of the instance with one tenant, else the tenant's. */
export function settingsRoute(input: { several: boolean; part: string | null; tab: string | null; query: string }): SettingsRoute {
    const moved = movedPage(input.part);
    if (moved) return { kind: "redirect", to: moved };
    if (!input.several) return { kind: "platform" };
    // A part of the open tenant, like Recently deleted, stays with the tenant settings.
    if (input.part && isTenantPart(input.part)) return { kind: "tenant" };
    // A part of the instance, also from an old `?tab=`, lives under Platform now.
    if (partFromAddress(input.part, input.tab)) return { kind: "redirect", to: withQuery("/dashboard/platform/settings", input.query) };
    return { kind: "tenant" };
}

/** What `/dashboard/platform/settings` shows: the settings of the instance, which one tenant keeps at Settings. */
export function platformSettingsRoute(input: { several: boolean; part: string | null; query: string }): SettingsRoute {
    const moved = movedPage(input.part);
    if (moved) return { kind: "redirect", to: moved };
    if (!input.several) return { kind: "redirect", to: withQuery("/dashboard/settings", input.query) };
    // A part of the open tenant is one of the tenant settings with several tenants.
    if (input.part && isTenantPart(input.part)) return { kind: "redirect", to: withQuery("/dashboard/settings", input.query) };
    return { kind: "platform" };
}
