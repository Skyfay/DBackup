import { areaOf, LEVEL_LABELS, permissionInfo, PERMISSION_AREAS, type AreaLevel } from "@/lib/auth/permission-areas";
import { AUDIT_ACTIONS } from "./audit-types";

/**
 * What an entry of the audit log says changed, as rows of a before and an after and as one short
 * line for a list. It reads the shapes the writers use: `changes` with a field each, `areas` and
 * `added` and `removed` for permissions, `renamedFrom`, and the reason of a failed sign-in.
 */

export interface ChangeRow {
    label: string;
    from: string | null;
    to: string | null;
    /** A secret, whose values are never kept. */
    secret?: boolean;
    /** The level of an area of permissions, drawn as levels instead of values. */
    level?: boolean;
    /** Permissions it added or removed, by name. */
    added?: string[];
    removed?: string[];
}

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []);

const levelLabel = (level: unknown) => LEVEL_LABELS[level as AreaLevel] ?? (typeof level === "string" ? level : null);
const permissionLabel = (id: string) => permissionInfo(id)?.label ?? id;

/** Every row of what changed, the name first, then the areas of permissions, then the fields. */
export function changesOf(details: Record<string, unknown>): ChangeRow[] {
    const rows: ChangeRow[] = [];
    const renamedFrom = text(details.renamedFrom);
    if (renamedFrom) rows.push({ label: "Name", from: renamedFrom, to: text(details.name) });

    const added = strings(details.added);
    const removed = strings(details.removed);
    const areas = Array.isArray(details.areas) ? details.areas : [];
    const shown = new Set<string>();
    for (const entry of areas) {
        if (!entry || typeof entry !== "object") continue;
        const { area, from, to } = entry as Record<string, unknown>;
        const info = PERMISSION_AREAS.find((candidate) => candidate.id === area);
        if (!info) continue;
        const inArea = (id: string) => areaOf(id)?.id === info.id;
        added.filter(inArea).forEach((id) => shown.add(id));
        removed.filter(inArea).forEach((id) => shown.add(id));
        rows.push({
            label: info.label,
            from: levelLabel(from),
            to: levelLabel(to),
            level: true,
            added: added.filter(inArea).map(permissionLabel),
            removed: removed.filter(inArea).map(permissionLabel),
        });
    }
    // Permissions whose area kept its level, like one picked by hand.
    const loose = { added: added.filter((id) => !shown.has(id)), removed: removed.filter((id) => !shown.has(id)) };
    if (loose.added.length > 0 || loose.removed.length > 0) {
        rows.push({ label: "Permissions", from: null, to: null, added: loose.added.map(permissionLabel), removed: loose.removed.map(permissionLabel) });
    }

    const changes = Array.isArray(details.changes) ? details.changes : [];
    for (const change of changes) {
        if (!change || typeof change !== "object") continue;
        const { field, from, to, secret } = change as Record<string, unknown>;
        const label = text(field);
        if (!label) continue;
        rows.push(secret === true ? { label, from: null, to: null, secret: true } : { label, from: text(from), to: text(to) });
    }
    return rows;
}

const MAX_IN_LINE = 2;

/** The change of one row in a few words, like "Backups See to Use" or "Schedule 03:00 to 02:30". */
function rowLine(row: ChangeRow): string {
    if (row.secret) return `${row.label} changed`;
    if (row.from === null && row.to === null) {
        const parts = [...(row.added ?? []).map((name) => `+${name}`), ...(row.removed ?? []).map((name) => `-${name}`)];
        return `${row.label} ${parts.join(" ")}`.trim();
    }
    return `${row.label} ${row.from ?? "none"} to ${row.to ?? "none"}`;
}

/** What changed in one line under the sentence of an entry, or null when there is nothing to add. */
export function changeSummary(action: string, details: Record<string, unknown>): string | null {
    if (action === AUDIT_ACTIONS.LOGIN_FAILED) {
        const reason = text(details.reason);
        return reason === "unknown_email" ? "No account has this email" : reason === "wrong_password" ? "The password was wrong" : null;
    }
    if (details.bulk === true && typeof details.requested === "number") {
        const failed = typeof details.failed === "number" ? details.failed : 0;
        return failed > 0 ? `${details.requested - failed} of ${details.requested}, ${failed} failed` : null;
    }
    const rows = changesOf(details);
    if (rows.length === 0) return null;
    const line = rows.slice(0, MAX_IN_LINE).map(rowLine).join(", ");
    return rows.length > MAX_IN_LINE ? `${line} and ${rows.length - MAX_IN_LINE} more` : line;
}
