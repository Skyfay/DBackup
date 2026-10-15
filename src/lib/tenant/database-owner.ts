import { Minimatch } from "minimatch";

/**
 * Which customer a database of a shared server belongs to at a point in time, from the assignments
 * of its name and the rules of the server. Plain data, so the owner's pages, the customer's list and
 * every download and restore decide it the same way.
 */

export interface AssignmentFact {
    databaseName: string;
    tenantId: string;
    validFrom: Date;
    validUntil: Date | null;
    /** The server the database went to when a move ended this assignment. */
    movedToSourceId?: string | null;
}

export interface RuleFact {
    pattern: string;
    tenantId: string;
    priority: number;
    validFrom: Date;
    createdAt: Date;
}

/** Whether a name matches the pattern of a rule, like `shop_*`. Names are compared as they are. */
export function matchesPattern(pattern: string, databaseName: string): boolean {
    const trimmed = pattern.trim();
    if (!trimmed) return false;
    return new Minimatch(trimmed, { dot: true, nocomment: true, nonegate: true }).match(databaseName);
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
    const matching = rules
        .filter((rule) => rule.validFrom.getTime() <= at.getTime() && matchesPattern(rule.pattern, databaseName))
        .sort((a, b) => b.priority - a.priority || a.createdAt.getTime() - b.createdAt.getTime());
    return matching[0] ?? null;
}

/**
 * The customer a database belonged to at a time, null for one that belonged to nobody but the
 * tenant of the server. An assignment of the name wins over every rule. A name that came back
 * later, after another customer had it, belongs to whoever held it at the time, which is why a
 * backup is judged by when it was made, never by who holds the name now. A name that moved to
 * another server belongs to nobody on this one from the move on, unless it is given again by name.
 */
export function ownerAt(assignments: readonly AssignmentFact[], rules: readonly RuleFact[], databaseName: string, at: Date): string | null {
    const assignment = assignmentAt(assignments, databaseName, at);
    if (assignment) return assignment.tenantId;
    if (movedAwayAt(assignments, databaseName, at)) return null;
    return ruleAt(rules, databaseName, at)?.tenantId ?? null;
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
