import { addDays, format } from "date-fns";
import { fromZonedTime } from "date-fns-tz";
import { matchesPattern, ruleAt, type RuleFact } from "@/lib/tenant/database-owner";
import type { AssignmentRow, DatabaseOwnerRow, MovePlace, RuleRow, SourceAssignments } from "@/services/tenant/database-assignments";

/**
 * The rules of the card that gives the databases of a shared server to other tenants, as plain
 * functions: who holds a database and how, how early a new assignment may start, what a rule gives
 * and what removing one takes away. The owner decides it the same way through
 * `lib/tenant/database-owner.ts`, so the card never tells another story than the backups do.
 */

/** The value of "Nobody else" in the picker and the filter, a database only the server's tenant sees. */
export const NOBODY = "nobody";

/** Who a database belongs to now, as the filter and the picker know it. */
export function ownerKey(row: Pick<DatabaseOwnerRow, "owner">): string {
    return row.owner?.tenantId ?? NOBODY;
}

/** "1 database", "3 databases". */
export function countOf(value: number, noun: string, plural = `${noun}s`): string {
    return `${value.toLocaleString()} ${value === 1 ? noun : plural}`;
}

/** The rules as the owner rules know them. */
function factsOf(rules: readonly RuleRow[]): (RuleFact & { row: RuleRow })[] {
    return rules.map((row) => ({
        id: row.id,
        pattern: row.pattern,
        tenantId: row.tenantId,
        priority: row.priority,
        validFrom: new Date(row.validFrom),
        validUntil: row.validUntil ? new Date(row.validUntil) : null,
        createdAt: new Date(row.createdAt),
        row,
    }));
}

/** The rules that still give, for the list of the card. An ended rule only decides the backups of its time. */
export function activeRules(rules: readonly RuleRow[]): RuleRow[] {
    return rules.filter((rule) => rule.validUntil === null);
}

/** The assignment of the name that holds now, the record of a database taken back included. */
function currentAssignment(assignments: readonly AssignmentRow[], databaseName: string): AssignmentRow | null {
    return assignments.find((entry) => entry.databaseName === databaseName && entry.validUntil === null) ?? null;
}

/** The rule that gives a database away now, the one the service picked for it. */
export function ruleFor(rules: readonly RuleRow[], databaseName: string, now: Date): RuleRow | null {
    return ruleAt(factsOf(rules), databaseName, now)?.row ?? null;
}

/** How the owner holds a database now, for the How column. */
export type How =
    | { kind: "assignment"; since: string; byName: string | null; from: MovePlace | null; onDemandPerDay: number | null }
    | { kind: "rule"; pattern: string; since: string; onDemandPerDay: number | null }
    /** It moved to another server, and the tenant that held it took it along. */
    | { kind: "moved"; at: string; to: MovePlace; before: string | null }
    /** Nobody else holds it, and a tenant did until then, by name or by a rule. */
    | { kind: "taken-back"; at: string; before: string | null }
    | { kind: "nobody" };

export function howOf(row: DatabaseOwnerRow, data: Pick<SourceAssignments, "assignments" | "rules">, now: Date): How {
    if (row.owner?.via === "assignment") {
        const current = data.assignments.find((entry) => entry.databaseName === row.name && entry.validUntil === null);
        return { kind: "assignment", since: row.owner.since, byName: current?.byName ?? null, from: current?.movedFrom ?? null, onDemandPerDay: row.owner.onDemandPerDay };
    }
    if (row.owner?.via === "rule") {
        const rule = ruleFor(data.rules, row.name, now);
        return { kind: "rule", pattern: rule?.pattern ?? "*", since: row.owner.since, onDemandPerDay: row.owner.onDemandPerDay };
    }
    const ended = endedAssignments(data.assignments).filter((entry) => entry.databaseName === row.name);
    const lastHolder = ended.find((entry) => entry.tenantName !== null)?.tenantName ?? null;
    // Taken back: the record of it holds now, whoever held it before.
    const back = currentAssignment(data.assignments, row.name);
    if (back && back.tenantId === null) return { kind: "taken-back", at: back.validFrom, before: lastHolder };
    const [last] = ended;
    if (last?.movedTo) return { kind: "moved", at: last.validUntil, to: last.movedTo, before: last.tenantName };
    return last ? { kind: "taken-back", at: last.validUntil, before: lastHolder } : { kind: "nobody" };
}

/** "3 backups a day on demand", or null while the tenant may start none. */
export function onDemandText(perDay: number | null): string | null {
    return perDay === null ? null : `Backups on demand, ${perDay} a day`;
}

/** The line under a database a move took to another server, like "to New MySQL as shop2". */
export function movedText(to: MovePlace, databaseName: string): string {
    return to.databaseName === databaseName ? `to ${to.serverName}` : `to ${to.serverName} as ${to.databaseName}`;
}

/** What a tenant holds of the server, for its line in the pickers: now, and before. */
export interface Holding {
    now: string[];
    /** Databases it held once and no longer does, the latest end first. */
    before: { name: string; from: string; until: string }[];
}

export function holdingOf(tenantId: string, data: Pick<SourceAssignments, "databases" | "assignments">): Holding {
    const now = data.databases.filter((row) => row.owner?.tenantId === tenantId).map((row) => row.name).sort((a, b) => a.localeCompare(b));
    const before = endedAssignments(data.assignments)
        .filter((entry) => entry.tenantId === tenantId && !now.includes(entry.databaseName))
        .map((entry) => ({ name: entry.databaseName, from: entry.validFrom, until: entry.validUntil }));
    return { now, before };
}

/** The line of a tenant in a picker, like "Has shop_a and shop_b of this server". `range` words a time it held one. */
export function holdingText(holding: Holding, range: (from: string, until: string) => string): string {
    const [first] = holding.before;
    const held = first ? `held ${first.name} ${range(first.from, first.until)}` : null;
    if (holding.now.length === 0) return held ? `Has none now · ${held}` : "No database of this server yet";
    const names = holding.now.length <= 2 ? `${holding.now.join(" and ")} of this server` : `${countOf(holding.now.length, "database")} of this server`;
    return held ? `Has ${names} · ${held}` : `Has ${names}`;
}

/** How many databases the quick filters of the table leave: every one, the ones given to a tenant, the server's tenant's alone. */
export type Quick = "all" | "given" | "nobody";

export function quickCounts(databases: readonly DatabaseOwnerRow[]): Record<Quick, number> {
    const given = databases.filter((row) => row.owner).length;
    return { all: databases.length, given, nobody: databases.length - given };
}

export function matchesQuick(row: Pick<DatabaseOwnerRow, "owner">, quick: Quick): boolean {
    return quick === "all" || (quick === "given" ? row.owner !== null : row.owner === null);
}

/** What giving several databases to one tenant changes: those it holds by name already stay as they are. */
export function giveChanges(rows: readonly DatabaseOwnerRow[], tenantId: string, validFrom: Date | undefined): { changes: { databaseName: string; tenantId: string; validFrom?: Date }[]; unchanged: string[] } {
    const unchanged = rows.filter((row) => row.owner?.via === "assignment" && row.owner.tenantId === tenantId).map((row) => row.name);
    const changes = rows
        .filter((row) => !unchanged.includes(row.name))
        .map((row) => ({ databaseName: row.name, tenantId, ...(validFrom ? { validFrom } : {}) }));
    return { changes, unchanged };
}

/** How many databases of the server a tenant holds once the given ones are its. */
export function heldAfter(databases: readonly DatabaseOwnerRow[], given: readonly string[], tenantId: string): number {
    return databases.filter((row) => given.includes(row.name) || row.owner?.tenantId === tenantId).length;
}

/** Why a new assignment of a name cannot start earlier, and since when it may. */
export type StartLimit =
    | { kind: "none" }
    /** Someone holds it by name now, or it was taken back, so the next one starts now. Null for taken back. */
    | { kind: "current"; from: Date; holder: string | null }
    /** The time of the one before ended then, and two never overlap. Null for a time it was taken back. */
    | { kind: "previous"; from: Date; holder: string | null };

/** How early an assignment of the name may start, so a backup never belongs to two tenants. */
export function startLimit(assignments: readonly AssignmentRow[], databaseName: string, now: Date): StartLimit {
    const own = assignments.filter((row) => row.databaseName === databaseName);
    const current = own.find((row) => row.validUntil === null && new Date(row.validFrom).getTime() <= now.getTime());
    if (current) return { kind: "current", from: now, holder: current.tenantName };
    const ended = own
        .filter((row): row is AssignmentRow & { validUntil: string } => row.validUntil !== null)
        .sort((a, b) => b.validUntil.localeCompare(a.validUntil))[0];
    return ended ? { kind: "previous", from: new Date(ended.validUntil), holder: ended.tenantName } : { kind: "none" };
}

/** The start of a day picked in a calendar, in the time zone of the viewer. */
export function dayStart(day: Date, timezone: string): Date {
    return fromZonedTime(`${format(day, "yyyy-MM-dd")}T00:00:00`, timezone);
}

/** Whether a day of the calendar can start an assignment or a rule: today or earlier, and not before the limit. */
export function dayAllowed(day: Date, timezone: string, now: Date, from: Date | null = null): boolean {
    if (dayStart(day, timezone).getTime() > now.getTime()) return false;
    return !from || dayStart(addDays(day, 1), timezone).getTime() > from.getTime();
}

/**
 * When a change starts: now without a picked day, else the start of that day, never before the
 * limit. Undefined lets the server take its own now.
 */
export function startOf(day: Date | null, timezone: string, now: Date, from: Date | null = null): Date | undefined {
    if (!day) return undefined;
    const start = dayStart(day, timezone);
    if (start.getTime() >= now.getTime()) return undefined;
    return from && start.getTime() < from.getTime() ? (from.getTime() >= now.getTime() ? undefined : from) : start;
}

/** A database a rule gives now, and who gets it once the rule is gone. */
export interface RuleLoss {
    name: string;
    /** The tenant another rule gives it to then, null for nobody else. */
    next: { tenantName: string; pattern: string } | null;
}

/** What removing a rule takes away now: the databases it gives, each with where it goes then. */
export function ruleLosses(data: Pick<SourceAssignments, "databases" | "rules">, ruleId: string, now: Date): RuleLoss[] {
    const rest = data.rules.filter((rule) => rule.id !== ruleId);
    return data.databases
        .filter((row) => row.owner?.via === "rule" && ruleFor(data.rules, row.name, now)?.id === ruleId)
        .map((row) => {
            const next = ruleFor(rest, row.name, now);
            return { name: row.name, next: next ? { tenantName: next.tenantName, pattern: next.pattern } : null };
        });
}

/** The databases each rule gives now, by its id, by name. */
export function ruleGives(data: Pick<SourceAssignments, "databases" | "rules">, now: Date): Map<string, string[]> {
    const gives = new Map<string, string[]>();
    for (const row of data.databases) {
        if (row.owner?.via !== "rule") continue;
        const rule = ruleFor(data.rules, row.name, now);
        if (rule) gives.set(rule.id, [...(gives.get(rule.id) ?? []), row.name]);
    }
    return gives;
}

/** What a new rule would do to one database the server holds now. */
export interface RuleEffect {
    name: string;
    outcome: "gains" | "keeps";
    /** Who keeps it and why, for a database the rule does not get. */
    reason?: string;
}

/** The databases a new rule matches and which of them it gets, before it is saved. */
export function rulePreview(
    data: Pick<SourceAssignments, "databases" | "rules"> & Partial<Pick<SourceAssignments, "assignments">>,
    input: { pattern: string; tenantId: string | null; priority: number },
    now: Date
): RuleEffect[] {
    const pattern = input.pattern.trim();
    if (!pattern) return [];
    return data.databases
        .filter((row) => matchesPattern(pattern, row.name))
        .map((row): RuleEffect => {
            if (row.owner?.via === "assignment") {
                return { name: row.name, outcome: "keeps", reason: `stays with ${row.owner.tenantName}, assigned by name` };
            }
            // A database taken back or moved away is given to nobody here by a rule.
            const back = !row.owner && currentAssignment(data.assignments ?? [], row.name);
            if (back && back.tenantId === null) return { name: row.name, outcome: "keeps", reason: "taken back, no rule gives it" };
            const moved = !row.owner && endedAssignments(data.assignments ?? []).find((entry) => entry.databaseName === row.name)?.movedTo;
            if (moved) return { name: row.name, outcome: "keeps", reason: `moved ${movedText(moved, row.name)}, no rule gives it here` };
            // A new rule is the youngest, so it loses every tie.
            const rival = ruleFor(data.rules, row.name, now);
            if (rival && rival.priority >= input.priority) {
                return rival.tenantId === input.tenantId
                    ? { name: row.name, outcome: "keeps", reason: `${rival.tenantName} has it already, rule ${rival.pattern}` }
                    : { name: row.name, outcome: "keeps", reason: `stays with ${rival.tenantName}, rule ${rival.pattern} ranks higher` };
            }
            return { name: row.name, outcome: "gains" };
        });
}

/** The assignments that ended, the latest end first, for what a tenant held before and a database taken back. */
export function endedAssignments(assignments: readonly AssignmentRow[]): (AssignmentRow & { validUntil: string })[] {
    return assignments
        .filter((row): row is AssignmentRow & { validUntil: string } => row.validUntil !== null)
        .sort((a, b) => b.validUntil.localeCompare(a.validUntil));
}

/** The toast after a database changed hands. */
export function changeText(databaseName: string, tenantName: string | null): string {
    return tenantName ? `${databaseName} belongs to ${tenantName} now` : `${databaseName} belongs to nobody else now`;
}
