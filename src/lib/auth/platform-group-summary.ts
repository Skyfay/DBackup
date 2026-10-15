import { accessLine, accessSentences, listWords, summarizeAccess } from "@/lib/auth/access-summary";
import { LEVEL_LABELS, levelOf, PLATFORM_AREAS, PLATFORM_GROUP_TENANT_AREAS, type AreaLevel, type PermissionArea } from "@/lib/auth/permission-areas";
import { PERMISSIONS } from "@/lib/auth/permissions";

/**
 * What a platform group lets its members do, in words: on the platform and in the tenants of its
 * scope, for the list of the platform groups, the summary of the editor and the picker of a user.
 * Plain functions, so the browser and the tests read the same words.
 */

const P = PERMISSIONS;

/** How each area on the platform reads in a sentence: what seeing it names, and what changing it does. */
const PLATFORM_WORDS: Record<string, { noun: string; short: string; change: string; sees: string; changes: string; write: string }> = {
    settings: {
        noun: "the settings",
        short: "settings",
        change: "changes the settings",
        sees: "Sees the settings of the instance",
        changes: "Changes the settings and the sign-in of the instance",
        write: P.SETTINGS.WRITE,
    },
    "platform-tenants": {
        noun: "the tenants",
        short: "tenants",
        change: "manages the tenants",
        sees: "Sees the tenants with their numbers",
        changes: "Creates, renames and deletes tenants and decides who works in them",
        write: P.PLATFORM.TENANTS_WRITE,
    },
    "platform-accounts": {
        noun: "the accounts",
        short: "accounts",
        change: "manages the accounts",
        sees: "Sees every account and the platform groups",
        changes: "Changes accounts and gives platform groups",
        write: P.PLATFORM.ACCOUNTS_WRITE,
    },
    "platform-sign-in": {
        noun: "the sign-in providers",
        short: "sign-in",
        change: "manages the sign-in providers",
        sees: "Sees the sign-in providers",
        changes: "Adds and changes the sign-in providers",
        write: P.PLATFORM.SIGN_IN_WRITE,
    },
    "platform-sharing": {
        noun: "the shared databases",
        short: "shared databases",
        change: "shares databases",
        sees: "Sees which tenant holds which shared database",
        changes: "Shares databases of the shared servers with tenants",
        write: P.PLATFORM.SHARING_WRITE,
    },
};

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Whether an area on the platform is held at all, and whether to change it. */
function platformHold(area: PermissionArea, held: ReadonlySet<string>): "none" | "see" | "change" {
    if (!area.permissions.some((permission) => held.has(permission.id))) return "none";
    return held.has(PLATFORM_WORDS[area.id]?.write ?? "") ? "change" : "see";
}

/** The areas that are not None, each with its level, like "Tenants See · Shared databases Change". */
export function levelsText(areas: readonly PermissionArea[], held: ReadonlySet<string>): string {
    return areas
        .map((area) => [area.label, levelOf(area, held)] as const)
        .filter(([, level]) => level !== "none")
        .map(([label, level]) => `${label} ${LEVEL_LABELS[level as AreaLevel]}`)
        .join(" · ");
}

/** The levels on the platform in one line. */
export const platformLevelsText = (held: ReadonlySet<string>) => levelsText(PLATFORM_AREAS, held);

/** The levels in the tenants in one line. */
export const tenantLevelsText = (held: ReadonlySet<string>) => levelsText(PLATFORM_GROUP_TENANT_AREAS, held);

/** What members may do on the platform in one line, like "Sees the tenants, shares databases". */
export function platformLine(held: ReadonlySet<string>): string {
    const sees: string[] = [];
    const changes: string[] = [];
    for (const area of PLATFORM_AREAS) {
        const hold = platformHold(area, held);
        if (hold === "see") sees.push(PLATFORM_WORDS[area.id].noun);
        if (hold === "change") changes.push(PLATFORM_WORDS[area.id].change);
    }
    if (sees.length === 0 && changes.length === 0) return "Nothing on the platform";
    return capitalize([...(sees.length > 0 ? [`sees ${listWords(sees)}`] : []), ...changes].join(", "));
}

/** What members may do in the tenants of the scope in one line, like "Runs jobs, restores backups, changes nothing". */
export function tenantLine(permissions: readonly string[]): string {
    if (permissions.length === 0) return "Nothing in the tenants";
    return accessLine(summarizeAccess(permissions));
}

/** One line of the summary of the editor: something a member can do, or what they cannot. */
export interface SummaryLine {
    text: string;
    /** A thing they can do, ticked. Otherwise it says what they cannot, behind a dash. */
    can: boolean;
}

/** What members may do on the platform, one line per area they hold and one for the rest. */
export function platformSentences(held: ReadonlySet<string>): SummaryLine[] {
    const lines: SummaryLine[] = [];
    const missing: string[] = [];
    for (const area of PLATFORM_AREAS) {
        const hold = platformHold(area, held);
        const words = PLATFORM_WORDS[area.id];
        if (hold === "none") missing.push(words.short);
        else lines.push({ text: hold === "change" ? words.changes : words.sees, can: true });
    }
    if (missing.length > 0) lines.push({ text: lines.length === 0 ? "Nothing on the platform" : `No ${listWords(missing)}`, can: false });
    return lines;
}

/** What members may do in each tenant of the scope, the sentences of a group of a tenant. */
export function tenantSentences(permissions: readonly string[]): SummaryLine[] {
    if (permissions.length === 0) return [{ text: "Nothing beyond their own group there", can: false }];
    return accessSentences(summarizeAccess(permissions)).map((sentence) => {
        const text = sentence.replace(/\.$/, "");
        return { text, can: text !== "Changes nothing" };
    });
}

/** Where a platform group counts, in a few words: "All tenants, new ones too" or "3 tenants". */
export function scopeText(group: { allTenants: boolean; tenantIds: readonly string[] }): string {
    if (group.allTenants) return "All tenants, new ones too";
    const count = group.tenantIds.length;
    return count === 0 ? "No tenant" : `${count.toLocaleString("en-US")} ${count === 1 ? "tenant" : "tenants"}`;
}

/** The line of a platform group in the picker of a user: on the platform, in the tenants, and where. */
export function pickerLine(group: { platformPermissions: readonly string[]; tenantPermissions: readonly string[]; allTenants: boolean; tenantIds: readonly string[] }): string {
    const platform = platformLine(new Set(group.platformPermissions));
    const parts = [
        ...(platform === "Nothing on the platform" ? [] : [platform]),
        ...(group.tenantPermissions.length > 0 ? [tenantLine(group.tenantPermissions).toLowerCase(), group.allTenants ? "all tenants" : scopeText(group).toLowerCase()] : []),
    ];
    return parts.length > 0 ? capitalize(parts.join(" · ")) : "Nothing yet";
}
