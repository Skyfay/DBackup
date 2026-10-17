import type { TenantMembersData } from "@/app/actions/tenant/members";
import { ALLOWANCE_KINDS, ALLOWANCE_NOUNS, limitsAnything, type AllowanceKind, type TenantAllowances } from "@/lib/tenant/allowances";
import type { TenantRemoval, TenantRow } from "@/services/tenant/tenant-service";
import type { TenantHealth, TenantSummary } from "@/services/tenant/tenant-summaries";

/**
 * The words and rules of the Tenants page as plain functions: what a delete loses, why a tenant
 * cannot be deleted, which accounts Add member offers, what the numbers above the list say, what
 * other tenants share with a tenant and what it may not add itself.
 */

/** A tenant as the Tenants page lists it: what it holds, its databases and how its backups went. */
export interface TenantListRow extends TenantRow {
    databases: number;
    health: TenantHealth;
}

/** The rows of the page, each with the databases and the health of its summary, none for a tenant without one. */
export function withSummaries(rows: readonly TenantRow[], summaries: readonly TenantSummary[]): TenantListRow[] {
    const byId = new Map(summaries.map((summary) => [summary.id, summary]));
    return rows.map((row) => ({ ...row, databases: byId.get(row.id)?.databases ?? 0, health: byId.get(row.id)?.health ?? null }));
}

/** "1 connection", "3 jobs". */
export function countOf(count: number, noun: string, plural = `${noun}s`): string {
    return `${count} ${count === 1 ? noun : plural}`;
}

/** The tenants whose newest backup of a job failed, and the ones where one missed a copy. */
export function troubledTenants(rows: readonly Pick<TenantListRow, "name" | "health">[]): { failed: string[]; partial: string[] } {
    return {
        failed: rows.filter((row) => row.health === "failed").map((row) => row.name),
        partial: rows.filter((row) => row.health === "partial").map((row) => row.name),
    };
}

/** "a", "a and b", "a, b and c". */
export function listText(items: string[]): string {
    if (items.length <= 1) return items[0] ?? "";
    return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** Why a tenant stays, or null when a platform admin may delete it. */
export function deleteRefusal(row: Pick<TenantRow, "id" | "isHome">, activeTenantId: string | null): string | null {
    if (row.isHome) return "The home tenant holds what the platform owns and is never deleted.";
    if (row.id === activeTenantId) return "You work in this tenant. Open another one first.";
    return null;
}

/** One line of what a delete takes with it, for the list of its dialog. */
export interface TenantLoss {
    name: string;
    detail: string;
}

/** What deleting a tenant loses, from the numbers of its row before it runs. */
export function deletionLoss(row: Pick<TenantRow, "connections" | "jobs" | "members">): TenantLoss[] {
    return [
        { name: countOf(row.connections, "connection"), detail: "with their health history" },
        { name: countOf(row.jobs, "job"), detail: "with their runs and logs" },
        { name: "Encryption keys and saved logins", detail: "its backups need these keys" },
        { name: "Templates, API keys and the audit log", detail: "everything else it holds" },
        { name: countOf(row.members, "membership"), detail: "the accounts stay" },
    ];
}

/** The toast after a delete, from what the server says it took. */
export function removalText(removal: TenantRemoval): string {
    const parts = [
        countOf(removal.connections, "connection"),
        countOf(removal.jobs, "job"),
        countOf(removal.runs, "run"),
        countOf(removal.keys, "encryption key"),
    ];
    return `${removal.name} is deleted with ${listText(parts)}.`;
}

/** The accounts Add member offers: every account that is no member of the tenant yet, by name. */
export function addableAccounts(data: Pick<TenantMembersData, "accounts" | "members">): TenantMembersData["accounts"] {
    const members = new Set(data.members.map((member) => member.id));
    return data.accounts.filter((account) => !members.has(account.id));
}

/** The destinations and channels shared with a tenant, or by it. */
type SharedCounts = TenantRow["provided"];

/** "2 destinations" and "1 channel", leaving out a kind with none. */
export function sharedParts(counts: SharedCounts): string[] {
    return [
        counts.destinations > 0 ? countOf(counts.destinations, "destination") : null,
        counts.channels > 0 ? countOf(counts.channels, "channel") : null,
    ].filter((part): part is string => part !== null);
}

/** What other tenants share with a tenant in a sentence, for the dialog of what it may add. */
export function providedSentence(provided: SharedCounts): string {
    const parts = sharedParts(provided);
    return parts.length > 0 ? `${listText(parts)} of other tenants` : "Nothing yet";
}

/** The short word of each kind in a tag, like "No own destinations, channels". */
const SHORT_NOUNS: Record<AllowanceKind, string> = {
    databases: "databases",
    directorySources: "directory sources",
    destinations: "destinations",
    channels: "channels",
    apiKeys: "API keys",
};

/**
 * What a tenant may not add itself, as the tag of its row and the sentence on hover, or null when
 * it adds everything. The home tenant always does.
 */
export function heldBack(row: Pick<TenantRow, "isHome" | "allowances">): { tag: string; sentence: string } | null {
    if (row.isHome || !limitsAnything(row.allowances)) return null;
    const off = ALLOWANCE_KINDS.filter((kind) => !row.allowances[kind]);
    const nouns = off.map((kind) => ALLOWANCE_NOUNS[kind]);
    const last = nouns.pop();
    return {
        tag: off.length === ALLOWANCE_KINDS.length ? "Adds nothing itself" : `No own ${off.map((kind) => SHORT_NOUNS[kind]).join(", ")}`,
        sentence: `Adds no ${nouns.length > 0 ? `${nouns.join(", ")} or ${last}` : last} of its own.`,
    };
}

/** The kinds whose switch differs from what the tenant has, with their new value, which is all Save sends. */
export function allowancesPatch(before: TenantAllowances, after: TenantAllowances): Partial<TenantAllowances> {
    return Object.fromEntries(ALLOWANCE_KINDS.filter((kind) => before[kind] !== after[kind]).map((kind) => [kind, after[kind]]));
}
