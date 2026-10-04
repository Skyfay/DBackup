import {
    BACKUP_STAGE_ORDER, INTEGRITY_CHECK_STAGE_ORDER, RESTORE_STAGE_ORDER, VERIFICATION_STAGE_ORDER,
    type LogEntry, type LogLevel, type LogType,
} from "@/lib/core/logs";
import type { RunStatus, RunStep } from "./run-types";

/**
 * The steps of a run out of its log: every line grouped under the step it was written in, how long
 * each step took next to its usual time, and how it ended. Pure, so it is tested on plain logs.
 */

const LEVELS: LogLevel[] = ["info", "success", "warning", "error"];
const TYPES: LogType[] = ["general", "command", "storage", "security"];

/** Steps that close a run and hold no work of their own. */
const CLOSING = new Set(["Completed", "Failed", "Cancelled"]);

/** Lines that sum up what other lines already say, which are no problem of their own. */
export const SUMMARY_LINES = [/^Upload summary:/i, /^Job completed/i, /^Execution was cancelled by user/i];

/** Read a stored log. Old runs kept plain strings, which become info lines of no step. */
export function parseLog(logs: string | null | undefined): LogEntry[] {
    if (!logs) return [];
    let value: unknown;
    try {
        value = JSON.parse(logs);
    } catch {
        return [];
    }
    if (!Array.isArray(value)) return [];
    return value.flatMap((raw): LogEntry[] => {
        if (typeof raw === "string") return [{ timestamp: "", level: "info", type: "general", message: raw, stage: "General" }];
        if (!raw || typeof raw !== "object") return [];
        const entry = raw as Partial<LogEntry>;
        return [{
            timestamp: typeof entry.timestamp === "string" ? entry.timestamp : "",
            level: LEVELS.includes(entry.level as LogLevel) ? entry.level as LogLevel : "info",
            type: TYPES.includes(entry.type as LogType) ? entry.type as LogType : "general",
            message: typeof entry.message === "string" ? entry.message : String(entry.message ?? ""),
            stage: typeof entry.stage === "string" && entry.stage ? entry.stage : "General",
            details: typeof entry.details === "string" ? entry.details : undefined,
            durationMs: typeof entry.durationMs === "number" ? entry.durationMs : undefined,
        }];
    });
}

/** The line a step writes when it ends, with how long it took. */
export function isStepSummary(entry: LogEntry): boolean {
    return typeof entry.durationMs === "number";
}

export function stageOrderOf(type: string): string[] {
    switch (type) {
        case "Restore":
            return RESTORE_STAGE_ORDER;
        case "IntegrityCheck":
            return INTEGRITY_CHECK_STAGE_ORDER;
        case "Verification":
            return VERIFICATION_STAGE_ORDER;
        case "Backup":
            return BACKUP_STAGE_ORDER;
        default:
            return [];
    }
}

/** How long each step took, from the lines that end the steps. The basis of the usual times. */
export function stepDurations(entries: LogEntry[]): Map<string, number> {
    const durations = new Map<string, number>();
    for (const entry of entries) {
        if (isStepSummary(entry) && entry.stage) durations.set(entry.stage, entry.durationMs!);
    }
    return durations;
}

export function median(values: number[]): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

/** The usual time of every step, the median over earlier runs. */
export function usualSteps(runs: LogEntry[][]): Map<string, number> {
    const collected = new Map<string, number[]>();
    for (const entries of runs) {
        for (const [stage, ms] of stepDurations(entries)) collected.set(stage, [...(collected.get(stage) ?? []), ms]);
    }
    return new Map([...collected].map(([stage, values]) => [stage, median(values)!]));
}

interface StepInput {
    type: string;
    status: RunStatus;
    /** The step a live run is in, from its metadata. */
    currentStage: string | null;
    now: number;
    usual: Map<string, number>;
}

function time(entry: LogEntry): number | null {
    const value = Date.parse(entry.timestamp);
    return Number.isFinite(value) ? value : null;
}

export function buildSteps(entries: LogEntry[], input: StepInput): RunStep[] {
    const live = input.status === "Running" || input.status === "Pending";
    const seen = [...new Set(entries.map((entry) => entry.stage ?? "General"))];
    const order = [...stageOrderOf(input.type), ...seen.filter((stage) => !stageOrderOf(input.type).includes(stage))]
        .filter((stage) => !CLOSING.has(stage));
    const current = input.currentStage ?? entries.at(-1)?.stage ?? null;

    return order.flatMap((stage): RunStep[] => {
        const own = entries.filter((entry) => (entry.stage ?? "General") === stage);
        const lines = own.filter((entry) => !isStepSummary(entry));
        const summary = own.filter(isStepSummary).at(-1);
        // Queued only matters for a run that waited.
        if (stage === "Queued" && (summary?.durationMs ?? 0) < 1000 && !live) return [];
        if (own.length === 0) {
            return [{ name: stage, state: live ? "pending" : "skipped", startedAt: null, durationMs: null, usualMs: input.usual.get(stage) ?? null, errors: 0, warnings: 0, lines: [] }];
        }
        const counted = lines.filter((entry) => !SUMMARY_LINES.some((pattern) => pattern.test(entry.message)));
        const errors = counted.filter((entry) => entry.level === "error").length;
        const warnings = counted.filter((entry) => entry.level === "warning").length;
        const first = own.map(time).find((value) => value !== null) ?? null;
        const last = [...own].reverse().map(time).find((value) => value !== null) ?? null;
        const running = live && stage === current;
        const durationMs = running
            ? (first !== null ? Math.max(0, input.now - first) : null)
            : summary?.durationMs ?? (first !== null && last !== null ? last - first : null);
        const state = running ? "running" : summary?.level === "error" || errors > 0 ? "failed" : warnings > 0 ? "warning" : "done";
        return [{
            name: stage,
            state,
            startedAt: first !== null ? new Date(first).toISOString() : null,
            durationMs,
            usualMs: input.usual.get(stage) ?? null,
            errors,
            warnings,
            lines: lines.map((entry) => ({ at: entry.timestamp, level: entry.level, type: entry.type, message: entry.message, ...(entry.details ? { details: entry.details } : {}) })),
        }];
    });
}
