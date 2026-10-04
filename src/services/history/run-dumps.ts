import type { LogEntry } from "@/lib/core/logs";
import { firstSentence, kindOf, sourceOf } from "@/lib/logs/line-source";
import { formatBytes } from "@/lib/utils";
import { knownProblem } from "./known-problems";
import type { RunDump, RunDumpProgress, RunKind, RunLine, RunOutput } from "./run-types";

/**
 * The databases of the dump step, one row each: what the tool said about it, the command it ran,
 * its output, its warnings by kind, and while it runs how far it is. MongoDB and SQL Server count
 * their own progress. For every other engine it is measured against the dump of the same
 * database in the last backup. Pure, so it is tested on plain logs.
 */

/** One database of the dump step as the runner recorded it, see DumpState. */
export interface DumpRecord {
    name: string;
    state: "waiting" | "dumping" | "done" | "failed";
    bytes: number | null;
    startedAt: string | null;
    endedAt: string | null;
}

const STATES = ["waiting", "dumping", "done", "failed"];

export function dumpRecordsOf(value: unknown): DumpRecord[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((raw): DumpRecord[] => {
        const entry = raw as Partial<DumpRecord> | null;
        if (!entry || typeof entry.name !== "string" || !STATES.includes(entry.state as string)) return [];
        return [{
            name: entry.name,
            state: entry.state as DumpRecord["state"],
            bytes: typeof entry.bytes === "number" ? entry.bytes : null,
            startedAt: typeof entry.startedAt === "string" ? entry.startedAt : null,
            endedAt: typeof entry.endedAt === "string" ? entry.endedAt : null,
        }];
    });
}

const START = /^Dumping database: (.+)$/;
const DONE = /^Completed dump for: (.+)$/;
const MONGO_PROGRESS = /\[[#.]+\]\s+(\S+?)\.(\S+)\s+(\d+)\/(\d+)\s+\(([\d.]+)%\)/;
const MONGO_DONE = /done dumping \S+?\.\S+ \((\d+) documents?\)/;
const SERVER_PERCENT = /^(\d+) percent processed/;
const SERVER_PAGES = /processed (\d+) pages in/i;
const SQLPACKAGE_TABLE = /^Processing Table '/;

interface Range {
    name: string;
    entries: LogEntry[];
    startedAt: string | null;
    endedAt: string | null;
    done: boolean;
}

/** The lines of the dump step cut into one range per database, from the line that starts it to the one that ends it. */
function rangesOf(entries: LogEntry[]): Range[] {
    const ranges: Range[] = [];
    let current: Range | null = null;
    for (const entry of entries) {
        const start = entry.type === "command" ? null : entry.message.match(START);
        if (start) {
            current = { name: start[1], entries: [], startedAt: entry.timestamp || null, endedAt: null, done: false };
            ranges.push(current);
            continue;
        }
        if (!current) continue;
        current.entries.push(entry);
        const done = entry.message.match(DONE);
        if (done && done[1] === current.name) {
            current.done = true;
            current.endedAt = entry.timestamp || null;
        }
    }
    return ranges;
}

function lineOf(entry: LogEntry, text: string): RunLine {
    return { at: entry.timestamp, level: entry.level, type: entry.type, message: text };
}

/** The lines a tool wrote, folded under its name in the order the tools first spoke. */
export function outputsOf(entries: LogEntry[]): RunOutput[] {
    const outputs: RunOutput[] = [];
    for (const entry of entries) {
        if (entry.type === "command") continue;
        const { source, text } = sourceOf(entry.message);
        if (!source) continue;
        const output = outputs.find((candidate) => candidate.source === source);
        if (output) output.lines.push(lineOf(entry, text));
        else outputs.push({ source, lines: [lineOf(entry, text)] });
    }
    return outputs;
}

/** Warnings grouped by what they say, the first line of each kind kept as it was written. */
export function kindsOf(entries: LogEntry[], step: string): RunKind[] {
    const kinds = new Map<string, RunKind>();
    for (const entry of entries) {
        if (entry.level !== "warning") continue;
        const { text } = sourceOf(entry.message);
        const key = kindOf(text);
        const kind = kinds.get(key);
        if (kind) {
            kind.count += 1;
            continue;
        }
        const known = knownProblem(text, { subject: null, step, jobName: null, subjectKind: null });
        kinds.set(key, { title: known?.title ?? firstSentence(text), count: 1, raw: text, help: known?.help ?? null });
    }
    return [...kinds.values()];
}

function count(value: number): string {
    return value.toLocaleString("en-US");
}

function time(value: string | null): number | null {
    if (!value) return null;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
}

/** What the tool said about a finished database, like how many documents or pages it wrote. */
function factsOf(outputs: RunOutput[]): string | null {
    const mongo = outputs.find((output) => output.source === "mongodump");
    if (mongo) {
        const done = mongo.lines.map((line) => line.message.match(MONGO_DONE)).filter((match): match is RegExpMatchArray => match !== null);
        if (done.length > 0) {
            const documents = done.reduce((sum, match) => sum + Number(match[1]), 0);
            return `${done.length} ${done.length === 1 ? "collection" : "collections"} · ${count(documents)} ${documents === 1 ? "document" : "documents"}`;
        }
    }
    const server = outputs.find((output) => output.source === "SQL Server")?.lines.map((line) => line.message.match(SERVER_PAGES)).find(Boolean);
    if (server) return `${count(Number(server[1]))} pages`;
    const tables = outputs.find((output) => output.source === "SqlPackage")?.lines.filter((line) => SQLPACKAGE_TABLE.test(line.message)).length ?? 0;
    if (tables > 0) return `${tables} ${tables === 1 ? "table" : "tables"}`;
    return null;
}

/** How far a database is that dumps right now, counted by its tool or measured against its last dump. */
function progressOf(outputs: RunOutput[], record: DumpRecord | undefined, startedAt: string | null, lastBytes: number | null, now: number): RunDumpProgress | null {
    const mongo = outputs.find((output) => output.source === "mongodump")?.lines ?? [];
    const lines = mongo.map((line) => ({ line, match: line.message.match(MONGO_PROGRESS) })).filter((entry) => entry.match !== null);
    const last = lines.at(-1);
    if (last?.match) {
        const [, , part, done, total, percent] = last.match;
        const first = lines.find((entry) => entry.match![2] === part)!;
        const elapsed = (time(last.line.at) ?? now) - (time(first.line.at) ?? now);
        const counted = Number(done) - Number(first.match![3]);
        const rate = elapsed > 0 && counted > 0 ? counted / elapsed : null;
        return {
            share: Math.min(Number(percent) / 100, 1),
            exact: true,
            text: `${count(Number(done))} of ${count(Number(total))} documents`,
            part,
            etaMs: rate ? Math.round((Number(total) - Number(done)) / rate) : null,
        };
    }
    const server = outputs.find((output) => output.source === "SQL Server")?.lines.map((line) => ({ line, match: line.message.match(SERVER_PERCENT) })).filter((entry) => entry.match).at(-1);
    if (server?.match) {
        const share = Number(server.match[1]) / 100;
        const elapsed = (time(server.line.at) ?? now) - (time(startedAt) ?? now);
        return { share, exact: true, text: `${server.match[1]} % by SQL Server`, part: null, etaMs: share > 0 && elapsed > 0 ? Math.round((elapsed * (1 - share)) / share) : null };
    }
    const bytes = record?.bytes ?? null;
    if (bytes === null) return { share: null, exact: false, text: "starting", part: null, etaMs: null };
    if (!lastBytes) return { share: null, exact: false, text: `${formatBytes(bytes, 1)} so far`, part: null, etaMs: null };
    const share = Math.min(bytes / lastBytes, 0.99);
    const elapsed = now - (time(startedAt) ?? now);
    const rate = elapsed > 0 ? bytes / elapsed : null;
    return {
        share,
        exact: false,
        text: `${formatBytes(bytes, 1)} of about ${formatBytes(lastBytes, 1)}`,
        part: null,
        etaMs: rate ? Math.max(0, Math.round((lastBytes - bytes) / rate)) : null,
    };
}

interface DumpInput {
    /** The lines of the dump step. */
    entries: LogEntry[];
    records: DumpRecord[];
    /** The databases the run names, for a run that recorded no dumps. */
    names: string[];
    /** The size of each dump in the last backup of the job. */
    previous: Map<string, number>;
    live: boolean;
    now: number;
}

export function buildDumps(input: DumpInput): RunDump[] {
    const ranges = rangesOf(input.entries);
    const names = input.records.length > 0 ? input.records.map((record) => record.name) : [...new Set([...ranges.map((range) => range.name), ...input.names])];
    return names.map((name): RunDump => {
        const record = input.records.find((entry) => entry.name === name);
        const range = [...ranges].reverse().find((entry) => entry.name === name);
        const entries = range?.entries ?? [];
        const outputs = outputsOf(entries);
        const lastRange = range !== undefined && range === ranges.at(-1);
        const state = record?.state
            ?? (range?.done ? "done" : range ? (input.live && lastRange ? "dumping" : "failed") : input.live ? "waiting" : "done");
        const startedAt = record?.startedAt ?? range?.startedAt ?? null;
        const endedAt = record?.endedAt ?? range?.endedAt ?? null;
        const start = time(startedAt);
        const end = time(endedAt);
        const lastBytes = input.previous.get(name) ?? null;
        const command = [...entries].reverse().find((entry) => entry.type === "command" && entry.details)?.details ?? null;
        return {
            name,
            state,
            bytes: record?.bytes ?? null,
            durationMs: start !== null && end !== null ? end - start : state === "dumping" && start !== null ? Math.max(0, input.now - start) : null,
            startedAt,
            facts: factsOf(outputs),
            lastBytes,
            command,
            outputs,
            warnings: kindsOf(entries, "Dumping Databases"),
            errors: entries.filter((entry) => entry.level === "error").map((entry) => sourceOf(entry.message).text),
            progress: state === "dumping" ? progressOf(outputs, record, startedAt, lastBytes, input.now) : null,
        };
    });
}

/** The size of each dump a finished run recorded, for the next run of the job to measure against. */
export function dumpSizes(records: DumpRecord[]): Map<string, number> {
    return new Map(records.filter((record) => record.state === "done" && record.bytes !== null).map((record) => [record.name, record.bytes!]));
}
