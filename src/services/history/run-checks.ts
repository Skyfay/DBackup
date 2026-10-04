import type { RunCheckDestination, RunChecks, RunCopyCheck } from "./run-types";

/**
 * What an integrity check or a verification checked: every copy with how it was checked and
 * what came out, and every destination with how far the run got there. A verification checks
 * the copies of one backup, an integrity check those of every backup, and both keep the same
 * record of each copy in their metadata. Pure, so it is tested on plain metadata.
 */

export interface CheckTarget {
    name: string;
    adapterId: string | null;
    /** Whether the destination checks a copy by a checksum it keeps, without a download. */
    native: boolean;
}

const STATES: RunCopyCheck["state"][] = ["waiting", "checking", "passed", "failed", "skipped", "error"];

function text(value: unknown): string | null {
    return typeof value === "string" && value.length > 0 ? value : null;
}

function number(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function copiesOf(value: unknown): RunCopyCheck[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((raw): RunCopyCheck[] => {
        const entry = raw as Record<string, unknown> | null;
        if (!entry || typeof entry.destinationId !== "string" || typeof entry.file !== "string") return [];
        const state = STATES.includes(entry.state as RunCopyCheck["state"]) ? entry.state as RunCopyCheck["state"] : "waiting";
        return [{
            destinationId: entry.destinationId,
            file: entry.file,
            size: number(entry.size),
            state,
            method: entry.method === "native" || entry.method === "download" ? entry.method : null,
            processed: number(entry.processed),
            total: number(entry.total),
            reason: text(entry.reason),
            expected: text(entry.expected),
            actual: text(entry.actual),
        }];
    });
}

interface PlanEntry {
    id: string;
    name: string;
    adapterId: string | null;
    count: number;
}

function planOf(value: unknown): { total: number; destinations: PlanEntry[] } | null {
    const plan = value as { total?: unknown; destinations?: unknown } | null;
    if (!plan || typeof plan.total !== "number" || !Array.isArray(plan.destinations)) return null;
    const destinations = plan.destinations.flatMap((raw): PlanEntry[] => {
        const entry = raw as Record<string, unknown> | null;
        if (!entry || typeof entry.id !== "string" || typeof entry.count !== "number") return [];
        return [{ id: entry.id, name: text(entry.name) ?? entry.id, adapterId: text(entry.adapterId), count: entry.count }];
    });
    return { total: plan.total, destinations };
}

const FINISHED = new Set(["passed", "failed", "skipped", "error"]);

/** The name of the folder a backup file lies in, which is the name of its job. */
function folderOf(file: string): string {
    const parts = file.split("/").filter(Boolean);
    return parts.length > 1 ? parts[0] : file;
}

export function buildChecks(type: string, metadata: { plan?: unknown; copies?: unknown }, targets: Map<string, CheckTarget>, live: boolean): RunChecks | null {
    if (type !== "IntegrityCheck" && type !== "Verification") return null;
    const copies = copiesOf(metadata.copies);
    const plan = planOf(metadata.plan);
    // A finished check from before copies were recorded keeps them in its log, and shows as a run like any other.
    if (!live && copies.length === 0 && !plan) return null;
    const entries: PlanEntry[] = plan?.destinations
        ?? [...new Set(copies.map((copy) => copy.destinationId))].map((id) => ({
            id, name: targets.get(id)?.name ?? id, adapterId: targets.get(id)?.adapterId ?? null, count: copies.filter((copy) => copy.destinationId === id).length,
        }));
    const destinations = entries.map((entry): RunCheckDestination => {
        const own = copies.filter((copy) => copy.destinationId === entry.id);
        return {
            id: entry.id,
            name: targets.get(entry.id)?.name ?? entry.name,
            adapterId: entry.adapterId ?? targets.get(entry.id)?.adapterId ?? null,
            total: entry.count,
            checked: own.filter((copy) => FINISHED.has(copy.state)).length,
            passed: own.filter((copy) => copy.state === "passed").length,
            differ: own.filter((copy) => copy.state === "failed").length,
            skipped: own.filter((copy) => copy.state === "skipped" || copy.state === "error").length,
            native: targets.get(entry.id)?.native ?? false,
        };
    });
    const first = copies[0];
    return {
        total: plan?.total ?? copies.length,
        destinations,
        copies,
        backup: type === "Verification" && first
            ? { name: folderOf(first.file), file: first.file.split("/").at(-1) ?? first.file, size: copies.map((copy) => copy.size ?? copy.total).find((size) => size !== null) ?? null }
            : null,
    };
}
