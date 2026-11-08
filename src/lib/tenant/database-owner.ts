import { Minimatch } from "minimatch";

/**
 * Which customer a database of a shared server belongs to at a point in time, from the assignments
 * of its name and the rules of the server. Plain data, so the owner's pages, the customer's list and
 * every download and restore decide it the same way.
 */

export interface AssignmentFact {
    databaseName: string;
    /** The customer, null when the tenant of the server took the database back. */
    tenantId: string | null;
    validFrom: Date;
    validUntil: Date | null;
    /** The server the database went to when a move ended this assignment. */
    movedToSourceId?: string | null;
    /** When it was given, which decides whether a start in the past reaches over another holder. */
    createdAt: Date;
}

export interface RuleFact {
    id?: string;
    pattern: string;
    tenantId: string;
    priority: number;
    validFrom: Date;
    /** When the rule was removed or its tenant deleted, null while it gives. */
    validUntil?: Date | null;
    createdAt: Date;
}

/** The compiled patterns, since every backup of a server asks the rules of its databases again. */
const matchers = new Map<string, Minimatch>();
const MATCHERS_MAX = 1000;

/** Whether a name matches the pattern of a rule, like `shop_*`. Names are compared as they are. */
export function matchesPattern(pattern: string, databaseName: string): boolean {
    const trimmed = pattern.trim();
    if (!trimmed) return false;
    let matcher = matchers.get(trimmed);
    if (!matcher) {
        if (matchers.size >= MATCHERS_MAX) matchers.clear();
        matcher = new Minimatch(trimmed, { dot: true, nocomment: true, nonegate: true });
        matchers.set(trimmed, matcher);
    }
    return matcher.match(databaseName);
}

/** The assignment of the name that holds at the time, if any. */
export function assignmentAt<T extends AssignmentFact>(assignments: readonly T[], databaseName: string, at: Date): T | null {
    return assignments.find((assignment) =>
        assignment.databaseName === databaseName
        && assignment.validFrom.getTime() <= at.getTime()
        && (assignment.validUntil === null || at.getTime() < assignment.validUntil.getTime())) ?? null;
}

/**
 * The assignment whose move took the name off its server by the time, if the last one that ended
 * by then ended with a move. From then on no rule of the server gives the name, only a new
 * assignment does, so a database that left does not come back to a customer through a pattern.
 */
export function movedAwayAt<T extends AssignmentFact>(assignments: readonly T[], databaseName: string, at: Date): T | null {
    const last = assignments
        .filter((assignment) => assignment.databaseName === databaseName && assignment.validUntil !== null && assignment.validUntil.getTime() <= at.getTime())
        .sort((a, b) => b.validUntil!.getTime() - a.validUntil!.getTime())[0];
    return last?.movedToSourceId ? last : null;
}

/** The rule that gives the name away at the time: the highest priority, of equal ones the oldest. */
export function ruleAt<T extends RuleFact>(rules: readonly T[], databaseName: string, at: Date): T | null {
    const time = at.getTime();
    const matching = rules
        .filter((rule) => rule.validFrom.getTime() <= time && (!rule.validUntil || time < rule.validUntil.getTime()) && matchesPattern(rule.pattern, databaseName))
        .sort((a, b) => b.priority - a.priority || a.createdAt.getTime() - b.createdAt.getTime() || (a.id ?? "").localeCompare(b.id ?? ""));
    return matching[0] ?? null;
}

/** What decides who a name belonged to at a time: an assignment of it, a move away, a rule, or nothing. */
export type Holder<A extends AssignmentFact, R extends RuleFact> =
    | { via: "assignment"; fact: A }
    | { via: "moved"; fact: A }
    | { via: "rule"; fact: R };

function decide<A extends AssignmentFact, R extends RuleFact>(assignments: readonly A[], rules: readonly R[], databaseName: string, at: Date): Holder<A, R> | null {
    const assignment = assignmentAt(assignments, databaseName, at);
    if (assignment) return { via: "assignment", fact: assignment };
    const moved = movedAwayAt(assignments, databaseName, at);
    if (moved) return { via: "moved", fact: moved };
    const rule = ruleAt(rules, databaseName, at);
    return rule ? { via: "rule", fact: rule } : null;
}

/** The customer of a holder, null for a move away, a database taken back, or no holder. */
export function tenantOfHolder(holder: Holder<AssignmentFact, RuleFact> | null): string | null {
    return holder && holder.via !== "moved" ? holder.fact.tenantId : null;
}

/**
 * What decides who a name belonged to at a time. An assignment of the name wins over every rule,
 * and a move away keeps every rule of the server off it. Who held it is settled by what was given
 * by then: an assignment or a rule made later that starts in the past only reaches times nobody
 * else held, so giving a database again, or a new rule of a higher priority, never takes the
 * backups of another customer's time. Of the claims made after the time, the first one that gives
 * the name to a customer keeps it, so a later claim never takes what an earlier one gave.
 */
export function holderAt<A extends AssignmentFact, R extends RuleFact>(assignments: readonly A[], rules: readonly R[], databaseName: string, at: Date): Holder<A, R> | null {
    const knownBy = (time: number) => (fact: { createdAt: Date }) => fact.createdAt.getTime() <= time;
    const later = [...new Set([...assignments, ...rules].map((fact) => fact.createdAt.getTime()).filter((time) => time > at.getTime()))]
        .sort((a, b) => a - b);
    for (const time of [at.getTime(), ...later]) {
        const held = decide(assignments.filter(knownBy(time)), rules.filter(knownBy(time)), databaseName, at);
        if (tenantOfHolder(held) !== null) return held;
    }
    return decide(assignments, rules, databaseName, at);
}

/**
 * The customer a database belonged to at a time, null for one that belonged to nobody but the
 * tenant of the server. A name that came back later, after another customer had it, belongs to
 * whoever held it at the time, which is why a backup is judged by when it was made, never by who
 * holds the name now. The id of a tenant deleted since stays the owner of its time, so its backups
 * go to nobody. See `holderAt`.
 */
export function ownerAt(assignments: readonly AssignmentFact[], rules: readonly RuleFact[], databaseName: string, at: Date): string | null {
    return tenantOfHolder(holderAt(assignments, rules, databaseName, at));
}

/** One database on one server, where a customer's database lives at some time. */
export interface DatabasePlace {
    sourceId: string;
    databaseName: string;
}

/** An assignment of one customer with the server it is on, for following a database across moves. */
export interface PlacedAssignment extends AssignmentFact {
    sourceId: string;
    movedToDatabase?: string | null;
}

const MOVES_MAX = 50;

/**
 * Where a database of a customer lives now that was at a place at a time: the place itself, or the
 * end of the moves the assignment that held it then went through. A backup made before a move
 * restores into the database at its new place, under its new name.
 */
export function followMoves(assignments: readonly PlacedAssignment[], tenantId: string, place: DatabasePlace, at: Date): DatabasePlace {
    let current: DatabasePlace = { sourceId: place.sourceId, databaseName: place.databaseName };
    let time = at;
    for (let step = 0; step < MOVES_MAX; step++) {
        const held = assignmentAt(
            assignments.filter((assignment) => assignment.tenantId === tenantId && assignment.sourceId === current.sourceId),
            current.databaseName,
            time
        );
        if (!held?.movedToSourceId || !held.validUntil) return current;
        current = { sourceId: held.movedToSourceId, databaseName: held.movedToDatabase || current.databaseName };
        // The assignment at the new place starts where this one ended.
        time = held.validUntil;
    }
    return current;
}
