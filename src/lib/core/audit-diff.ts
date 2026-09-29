import type { AuditChange } from "./audit-types";

/** A value of a field as the audit log keeps it. */
export type AuditValue = string | number | boolean | null | undefined | readonly string[];

export interface AuditField {
    label: string;
    /** Never kept with its value, only that it changed. */
    secret?: boolean;
}

/** A value as the audit log shows it: On or Off, a list joined with commas, null for nothing. */
export function auditValue(value: AuditValue): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value === "boolean") return value ? "On" : "Off";
    if (Array.isArray(value)) return value.length === 0 ? null : [...value].join(", ");
    const text = String(value).trim();
    return text === "" ? null : text;
}

/**
 * The fields that differ between two snapshots of a record, in the order of `fields`. Lists count
 * as equal when they hold the same entries, so a new order is no change.
 */
export function diffFields<K extends string>(before: Partial<Record<K, AuditValue>>, after: Partial<Record<K, AuditValue>>, fields: Record<K, AuditField>): AuditChange[] {
    const changes: AuditChange[] = [];
    for (const key of Object.keys(fields) as K[]) {
        const from = before[key];
        const to = after[key];
        const same = Array.isArray(from) && Array.isArray(to)
            ? from.length === to.length && [...from].sort().join("\u0000") === [...to].sort().join("\u0000")
            : auditValue(from) === auditValue(to);
        if (same) continue;
        const { label, secret } = fields[key];
        changes.push(secret ? { field: label, from: null, to: null, secret: true } : { field: label, from: auditValue(from), to: auditValue(to) });
    }
    return changes;
}
