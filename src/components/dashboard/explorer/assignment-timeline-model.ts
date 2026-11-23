import { holderAt, type AssignmentFact, type RuleFact } from "@/lib/tenant/database-owner";
import type { AssignmentRow, MovePlace, RuleRow, SourceAssignments } from "@/services/tenant/database-assignments";

/**
 * Who held each database of a shared server and when, as the timeline of the card draws it: a line
 * per database with a segment for every stretch one tenant held it, by name or by a rule, and the
 * stretches nobody but the server's tenant did. The owner rules of `database-owner.ts` decide every
 * moment, so the timeline tells the same story as the backups each tenant sees. Plain functions,
 * so the rules can be tested.
 */

export interface HoldSegment {
    /** Start in ms, null for a stretch that reaches back before anything was given. */
    from: number | null;
    /** End in ms, null while it lasts. */
    to: number | null;
    tenantId: string | null;
    tenantName: string | null;
    via: "assignment" | "rule" | null;
    /** The pattern of the rule that gives it. */
    pattern?: string;
    /** Who gave it by name. */
    byName?: string | null;
    /** Where the database went, on the stretch nobody holds it here since it moved. */
    movedTo?: MovePlace;
}

export interface HoldLine {
    name: string;
    /** Whether the server holds it now. A name given once that is gone since keeps its line. */
    listed: boolean;
    segments: HoldSegment[];
    /** The last segment, the one that holds now. */
    current: HoldSegment;
}

type AssignmentFactRow = AssignmentFact & { row: AssignmentRow };
type RuleFactRow = RuleFact & { row: RuleRow };

function assignmentFacts(rows: readonly AssignmentRow[]): AssignmentFactRow[] {
    return rows.map((row) => ({
        databaseName: row.databaseName,
        tenantId: row.tenantId,
        validFrom: new Date(row.validFrom),
        validUntil: row.validUntil ? new Date(row.validUntil) : null,
        movedToSourceId: row.movedTo?.sourceId ?? null,
        createdAt: new Date(row.createdAt),
        row,
    }));
}

function ruleFacts(rows: readonly RuleRow[]): RuleFactRow[] {
    return rows.map((row) => ({
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

/** Who held the name at a moment, as a segment without its bounds. */
function segmentAt(assignments: readonly AssignmentFactRow[], rules: readonly RuleFactRow[], name: string, at: number): Omit<HoldSegment, "from" | "to"> {
    const holder = holderAt(assignments, rules, name, new Date(at));
    // A database taken back belongs to nobody here, whatever a rule matches.
    if (holder?.via === "assignment") return { tenantId: holder.fact.tenantId, tenantName: holder.fact.row.tenantName, via: holder.fact.tenantId ? "assignment" : null, byName: holder.fact.row.byName };
    // A database that moved away belongs to nobody here, whatever a rule matches.
    if (holder?.via === "moved" && holder.fact.row.movedTo) return { tenantId: null, tenantName: null, via: null, movedTo: holder.fact.row.movedTo };
    if (holder?.via === "rule") return { tenantId: holder.fact.tenantId, tenantName: holder.fact.row.tenantName, via: "rule", pattern: holder.fact.pattern };
    return { tenantId: null, tenantName: null, via: null };
}

const sameHolder = (a: Omit<HoldSegment, "from" | "to">, b: Omit<HoldSegment, "from" | "to">) =>
    a.tenantId === b.tenantId && a.via === b.via && a.pattern === b.pattern && a.movedTo?.sourceId === b.movedTo?.sourceId;

/** The stretches of one name, oldest first, from the first change up to now. */
export function holdSegments(name: string, data: Pick<SourceAssignments, "assignments" | "rules">, now: Date): HoldSegment[] {
    const assignments = assignmentFacts(data.assignments);
    const rules = ruleFacts(data.rules);
    const end = now.getTime();
    const points = new Set<number>();
    // Who holds it changes where a holding starts or ends, and where one given later with a start
    // in the past begins to count, see `holderAt`.
    for (const fact of assignments) {
        if (fact.databaseName !== name) continue;
        points.add(fact.validFrom.getTime());
        points.add(fact.createdAt.getTime());
        if (fact.validUntil) points.add(fact.validUntil.getTime());
    }
    for (const fact of rules) {
        points.add(fact.validFrom.getTime());
        points.add(fact.createdAt.getTime());
        if (fact.validUntil) points.add(fact.validUntil.getTime());
    }
    const changes = [...points].filter((point) => point <= end).sort((a, b) => a - b);

    const segments: HoldSegment[] = [{ from: null, to: null, tenantId: null, tenantName: null, via: null }];
    for (const point of changes) {
        const holder = segmentAt(assignments, rules, name, point);
        const last = segments[segments.length - 1];
        if (sameHolder(last, holder)) continue;
        last.to = point;
        segments.push({ from: point, to: null, ...holder });
    }
    return segments;
}

/** Every database of the server with who held it when: the ones it holds now, then names given once that are gone. */
export function holdLines(data: Pick<SourceAssignments, "databases" | "assignments" | "rules">, now: Date): HoldLine[] {
    const listed = new Set(data.databases.map((row) => row.name));
    const gone = [...new Set(data.assignments.map((row) => row.databaseName).filter((name) => !listed.has(name)))].sort((a, b) => a.localeCompare(b));
    return [...data.databases.map((row) => row.name), ...gone].map((name) => {
        const segments = holdSegments(name, data, now);
        return { name, listed: listed.has(name), segments, current: segments[segments.length - 1] };
    });
}

/** Whether a tenant held the database at any time, for the Tenant filter of the timeline. */
export function heldBy(line: HoldLine, tenantId: string): boolean {
    return line.segments.some((segment) => segment.tenantId === tenantId);
}

/** The backups the destinations keep of a stretch, by the times the backups were made. */
export function backupsIn(dates: readonly string[] | undefined, segment: Pick<HoldSegment, "from" | "to">): number {
    return (dates ?? []).filter((iso) => {
        const at = Date.parse(iso);
        return (segment.from === null || at >= segment.from) && (segment.to === null || at < segment.to);
    }).length;
}

/** The days a stretch lasted, up to now while it lasts. Null for one without a start. */
export function daysHeld(segment: Pick<HoldSegment, "from" | "to">, now: Date): number | null {
    if (segment.from === null) return null;
    return Math.max(0, Math.round(((segment.to ?? now.getTime()) - segment.from) / 86_400_000));
}

export type TimelineRange = "year" | "all";

/** The span the timeline shows: the last twelve months, or since the first change or backup. */
export function rangeOf(range: TimelineRange, lines: readonly HoldLine[], dates: Record<string, string[]>, now: Date): { start: number; end: number } {
    const end = now.getTime();
    const year = end - 365 * 86_400_000;
    if (range === "year") return { start: year, end };
    const starts = [
        ...lines.flatMap((line) => line.segments.flatMap((segment) => (segment.from === null ? [] : [segment.from]))),
        ...Object.values(dates).flatMap((list) => (list[0] ? [Date.parse(list[0])] : [])),
    ];
    const first = Math.min(...starts, year);
    // A little room before the first change, so its segment does not start at the very edge.
    return { start: first - (end - first) * 0.03, end };
}

/** Where a moment sits on the track, from 0 to 100. */
export function percentAt(at: number | null, range: { start: number; end: number }): number {
    if (at === null || at <= range.start) return 0;
    if (at >= range.end) return 100;
    return ((at - range.start) / (range.end - range.start)) * 100;
}

/** The first day of every month in the range, for the axis. */
export function monthsIn(range: { start: number; end: number }): number[] {
    const first = new Date(range.start);
    const months: number[] = [];
    for (let month = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 1)); month.getTime() <= range.end; month = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1))) {
        months.push(month.getTime());
    }
    return months;
}

/** How many times a database changed hands this calendar year, and when last, for the foot of the rules. */
export function changesThisYear(lines: readonly HoldLine[], now: Date): { count: number; last: { at: number; name: string } | null } {
    const yearStart = Date.UTC(now.getUTCFullYear(), 0, 1);
    let count = 0;
    let last: { at: number; name: string } | null = null;
    for (const line of lines) {
        for (const segment of line.segments) {
            if (segment.from === null || segment.from < yearStart) continue;
            count++;
            if (!last || segment.from > last.at) last = { at: segment.from, name: line.name };
        }
    }
    return { count, last };
}
