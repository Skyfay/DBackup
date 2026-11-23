import type { LogEntry } from "@/lib/core/logs";
import { parseCommand, sourceOf } from "@/lib/logs/line-source";
import { formatBytes, formatDuration } from "@/lib/utils";
import type { RestoreRecord, RestoredDatabase, RestoredFolder, RestoredState } from "@/services/restore/restore-record";
import { kindsOf, outputsOf } from "./run-dumps";
import { between, plural } from "./run-summary";
import type { RunDump, RunOutput, RunSummaryItem } from "./run-types";

/**
 * The rows of a restore: a database each, from the record the restore kept and the lines between
 * the fetch of its dump and the line that ends it, and a folder each with where its files went.
 * A run of a restore from before the record still gets its databases out of the log. Pure, so it
 * is tested on plain logs.
 */

const STATES: readonly string[] = ["waiting", "restoring", "done", "failed"];
const FOLDER_STATES: readonly string[] = [...STATES, "partial"];

const text = (value: unknown): string | null => (typeof value === "string" ? value : null);
const count = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

function databaseOf(raw: unknown): RestoredDatabase[] {
    const entry = raw as Record<string, unknown> | null;
    if (!entry || typeof entry.name !== "string" || !STATES.includes(entry.state as string)) return [];
    return [{
        name: entry.name,
        target: text(entry.target) ?? entry.name,
        state: entry.state as RestoredState,
        bytes: count(entry.bytes),
        startedAt: text(entry.startedAt),
        endedAt: text(entry.endedAt),
        percent: count(entry.percent),
        detail: text(entry.detail),
    }];
}

function folderOf(raw: unknown): RestoredFolder[] {
    const entry = raw as Record<string, unknown> | null;
    if (!entry || typeof entry.id !== "string" || typeof entry.label !== "string" || !FOLDER_STATES.includes(entry.state as string)) return [];
    return [{
        id: entry.id,
        label: entry.label,
        target: text(entry.target) ?? "",
        adapterId: text(entry.adapterId),
        state: entry.state as RestoredFolder["state"],
        files: count(entry.files) ?? 0,
        total: count(entry.total) ?? 0,
        failed: count(entry.failed) ?? 0,
        skipped: count(entry.skipped) ?? 0,
        bytes: count(entry.bytes) ?? 0,
        totalBytes: count(entry.totalBytes) ?? 0,
        startedAt: text(entry.startedAt),
        endedAt: text(entry.endedAt),
    }];
}

/** The record a restore kept in the metadata of its run, null for a run that kept none. */
export function restoreRecordOf(value: unknown): RestoreRecord | null {
    if (!value || typeof value !== "object") return null;
    const raw = value as Record<string, unknown>;
    const from = raw.from as { name?: unknown; adapterId?: unknown } | null | undefined;
    return {
        from: from && typeof from.name === "string" ? { name: from.name, adapterId: text(from.adapterId) ?? "" } : null,
        archive: text(raw.archive),
        ranged: typeof raw.ranged === "boolean" ? raw.ranged : null,
        read: count(raw.read) ?? 0,
        backupVersion: text(raw.backupVersion),
        targetVersion: text(raw.targetVersion),
        databases: Array.isArray(raw.databases) ? raw.databases.flatMap(databaseOf) : [],
        folders: Array.isArray(raw.folders) ? raw.folders.flatMap(folderOf) : [],
    };
}

const FETCH = /^Fetching dump for '(.+)' \(/;
const MOVE = /^Restoring database: (.+) → (.+)$/;
const RESTORED = /^Database restored: (.+)$/;
const FAILED = /^Failed to restore database '(.+?)': (.*)$/;
const MISSING = /^Database '(.+)' is missing from the archive index$/;
/** The lines DBackup writes about a database, which its row says in its own words. */
const MARKERS = [FETCH, MOVE, RESTORED, FAILED, MISSING];
/** A program that names itself in front of its lines, like `pg_restore: connecting to database`. */
const PROGRAM = /^([a-z][a-z0-9_.-]*): /;

/** "1,204 files", with the separators a large count needs. */
export function files(count: number): string {
    return `${count.toLocaleString("en-US")} ${count === 1 ? "file" : "files"}`;
}

/**
 * The lines the tool of a database wrote, under its name: the program of its command, or the one
 * that names itself in front of its lines, like pg_restore, whose name the line then leaves out.
 */
function toolOutputs(entries: LogEntry[], command: string | null, name: string): RunOutput[] {
    const own = entries.filter((entry) => entry.type !== "command" && !MARKERS.some((pattern) => pattern.test(entry.message)));
    const binary = command ? parseCommand(command)?.binary.split("/").at(-1) ?? null : null;
    const tool = binary ?? own.map((entry) => entry.message.match(PROGRAM)?.[1]).find(Boolean) ?? null;
    const outputs = outputsOf(own);
    const plain = own.filter((entry) => sourceOf(entry.message).source === null);
    if (plain.length > 0) {
        outputs.push({
            source: tool ?? name,
            lines: plain.map((entry) => ({
                at: entry.timestamp,
                level: entry.level,
                type: entry.type,
                message: tool && entry.message.startsWith(`${tool}: `) ? entry.message.slice(tool.length + 2) : entry.message,
            })),
        });
    }
    return outputs;
}

/** What went wrong with a database: the errors of its tool, else the reason DBackup gave. */
function errorsOf(entries: LogEntry[]): string[] {
    const errors = entries.filter((entry) => entry.level === "error");
    const own = errors.filter((entry) => !MARKERS.some((pattern) => pattern.test(entry.message))).map((entry) => sourceOf(entry.message).text);
    if (own.length > 0) return own;
    return errors.flatMap((entry) => {
        const failed = entry.message.match(FAILED);
        return failed ? [failed[2]] : MISSING.test(entry.message) ? ["It is missing from the archive."] : [];
    });
}

interface Range {
    name: string;
    target: string;
    entries: LogEntry[];
    end: "done" | "failed" | null;
    endedAt: string | null;
}

/** The lines of each database, from the fetch of its dump to the line that ends it. */
function rangesOf(entries: LogEntry[]): Range[] {
    const ranges: Range[] = [];
    let current: Range | null = null;
    for (const entry of entries) {
        const plain = entry.type === "command" ? null : entry.message;
        const missing = plain?.match(MISSING);
        if (missing) {
            ranges.push({ name: missing[1], target: missing[1], entries: [entry], end: "failed", endedAt: entry.timestamp || null });
            current = null;
            continue;
        }
        const fetch = plain?.match(FETCH);
        if (fetch) {
            current = { name: fetch[1], target: fetch[1], entries: [], end: null, endedAt: null };
            ranges.push(current);
        }
        if (!current) continue;
        current.entries.push(entry);
        const move = plain?.match(MOVE);
        if (move && move[1] === current.name) current.target = move[2];
        const ended = plain?.match(RESTORED)?.[1] === current.target ? "done" : plain?.match(FAILED)?.[1] === current.name ? "failed" : null;
        if (ended) {
            current.end = ended;
            current.endedAt = entry.timestamp || null;
            current = null;
        }
    }
    return ranges;
}

const DUMP_STATE: Record<RestoredState, RunDump["state"]> = { waiting: "waiting", restoring: "dumping", done: "done", failed: "failed" };

interface DumpInput {
    /** The lines of the step that restores the databases. */
    entries: LogEntry[];
    record: RestoreRecord | null;
    /** A customer's run, whose log keeps no command since it names the server. */
    shared: boolean;
    live: boolean;
    now: number;
}

/** The databases of a restore, one row each, the one it restores now with how far it is. */
export function restoreDumps(input: DumpInput): RunDump[] {
    const ranges = rangesOf(input.entries);
    const planned: RestoredDatabase[] = input.record && input.record.databases.length > 0
        ? input.record.databases
        : ranges.map((range, index) => ({
            name: range.name,
            target: range.target,
            state: range.end === "done" ? "done" : range.end === "failed" ? "failed" : input.live && index === ranges.length - 1 ? "restoring" : "failed",
            bytes: null,
            startedAt: range.entries[0]?.timestamp || null,
            endedAt: range.endedAt,
            percent: null,
            detail: null,
        }));
    return planned.map((database): RunDump => {
        const entries = [...ranges].reverse().find((range) => range.name === database.name)?.entries ?? [];
        const state = DUMP_STATE[database.state];
        const startedAt = database.startedAt ?? entries[0]?.timestamp ?? null;
        const command = [...entries].reverse().find((entry) => entry.type === "command" && entry.details)?.details ?? null;
        const hidden = !command && input.shared && entries.some((entry) => entry.type === "command");
        const running = state === "dumping";
        return {
            name: database.name,
            target: database.target,
            note: hidden ? "Its command names the server, so it stays in the run of the provider." : null,
            state,
            bytes: database.bytes,
            durationMs: running && startedAt ? Math.max(0, input.now - Date.parse(startedAt)) : between(startedAt, database.endedAt),
            startedAt,
            facts: null,
            lastBytes: null,
            command,
            outputs: toolOutputs(entries, command, database.name),
            warnings: kindsOf(entries, "Restoring Databases"),
            errors: errorsOf(entries),
            progress: running
                ? { share: database.percent !== null ? database.percent / 100 : null, exact: true, text: database.detail ?? (database.percent !== null ? `${database.percent} %` : "starting"), part: null, etaMs: null }
                : null,
        };
    });
}

const FOLDER_ITEM: Record<RestoredFolder["state"], RunSummaryItem["state"]> = { waiting: "waiting", restoring: "running", done: "done", partial: "warning", failed: "failed" };

function folderText(folder: RestoredFolder): string {
    const took = between(folder.startedAt, folder.endedAt);
    switch (folder.state) {
        case "waiting":
            return "waits";
        case "restoring":
            return `${folder.files.toLocaleString("en-US")} of ${files(folder.total)} · ${formatBytes(folder.bytes)} of ${formatBytes(folder.totalBytes)}`;
        case "done":
            return [files(folder.files), formatBytes(folder.bytes), took !== null ? formatDuration(took) : null].filter(Boolean).join(" · ");
        case "partial":
            return [`${folder.files.toLocaleString("en-US")} of ${files(folder.total)}`, folder.failed > 0 ? `${folder.failed} failed` : null,
                folder.skipped > 0 ? `${plural(folder.skipped, "link")} skipped` : null].filter(Boolean).join(", ");
        default:
            return folder.total > 0 ? `none of ${files(folder.total)}` : "its target could not be opened";
    }
}

/** The folders of a restore, one row each with where its files went and the lines about it. */
export function restoreFolders(entries: LogEntry[], record: RestoreRecord | null): RunSummaryItem[] {
    return (record?.folders ?? []).map((folder): RunSummaryItem => {
        const label = folder.target ? `${folder.label} → ${folder.target}` : folder.label;
        const lines = entries.filter((entry) => entry.message.includes(folder.label) || (folder.target !== "" && entry.message.includes(folder.target)));
        return {
            key: folder.id,
            label,
            adapterId: folder.adapterId,
            state: FOLDER_ITEM[folder.state],
            text: folderText(folder),
            outputs: lines.length > 0 ? [{ source: label, lines: lines.map((entry) => ({ at: entry.timestamp, level: entry.level, type: entry.type, message: entry.message, details: entry.details })) }] : [],
        };
    });
}
