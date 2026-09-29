import type { AuditQuick } from "@/lib/core/audit-areas";
import type { ChangeRow } from "@/lib/core/audit-changes";
import type { EntryGlyph, EntryKind, SentencePart } from "@/lib/core/audit-sentence";

/**
 * What the Audit log tab of the Users & Groups page shows. Plain data, so the browser can import
 * it without the services behind it.
 */

/** Who an entry came from: a person, one of their API keys, or nobody, like a failed sign-in. */
export interface AuditActor {
    kind: "person" | "key" | "unknown";
    /** The key of the Who filter, like `user:<id>`, `key:<id>`, `deleted:<name>` or `unknown`. */
    key: string;
    name: string;
    /** A line under the name, like the group of a person or the owner of a key. */
    sub: string | null;
    image: string | null;
    /** The person was deleted since, the name is the one the entry kept. */
    deleted: boolean;
}

export interface AuditRow {
    id: string;
    at: string;
    actor: AuditActor;
    action: string;
    resource: string;
    resourceId: string | null;
    area: string | null;
    parts: SentencePart[];
    /** What changed in one line, like "Backups See to Use". */
    summary: string | null;
    glyph: EntryGlyph;
    kind: EntryKind;
    /** Like "Firefox on macOS", or the tool, like "curl/8.5". */
    device: string | null;
    ipAddress: string | null;
    /** A sign-in from a network this person never signed in from before, while they had signed in before. */
    newPlace: boolean;
}

export interface AuditStats {
    /** The days the numbers cover and the days the log keeps. */
    days: number;
    keptDays: number;
    entries: number;
    signIns: { count: number; people: number; newPlaces: number };
    changes: { count: number; areas: string[] };
    sensitive: { count: number; reveals: number; downloads: number; restores: number };
    failed: { count: number; last: { at: string; ipAddress: string | null } | null };
}

export interface AuditWhoOption {
    value: string;
    label: string;
    group: "People" | "API keys" | "Other";
    image: string | null;
    deleted: boolean;
}

export interface AuditFacets {
    who: Record<string, number>;
    area: Record<string, number>;
    action: Record<string, number>;
    quick: Record<AuditQuick, number>;
}

export interface AuditPage {
    rows: AuditRow[];
    total: number;
    facets: AuditFacets;
    who: AuditWhoOption[];
    stats: AuditStats;
}

export interface AuditLine {
    id: string;
    at: string;
    by: string | null;
    parts: SentencePart[];
    glyph: EntryGlyph;
    kind: EntryKind;
}

export interface AuditDetails {
    id: string;
    changes: ChangeRow[];
    /** The sign-in the entry came from, the newest of the person before it. */
    signIn: { at: string; method: string | null; device: string | null; ipAddress: string | null } | null;
    /** For a sign-in: what the person did until they signed in again or out, oldest first. */
    session: { lines: AuditLine[]; endedAt: string | null; signedOut: boolean } | null;
    /** For a sign-in from a new place: the networks the person signed in from before. */
    usualNetworks: string[];
    /** The entries of the same record before this one, newest first. */
    earlier: AuditLine[];
    record: { label: string; href: string } | null;
    browser: string | null;
    /** The details as they were written, formatted. */
    stored: string | null;
    keptDays: number;
}

export interface AuditTimelineRow {
    actor: AuditActor;
    total: number;
    /** Per day of the range: how many entries and how many of them are sensitive. */
    days: Record<string, { count: number; sensitive: number }>;
}

export interface AuditTimeline {
    from: string;
    to: string;
    rows: AuditTimelineRow[];
}
