import type { LogEntry } from "@/lib/core/logs";
import { parseCommand, sourceOf } from "@/lib/logs/line-source";
import { formatBytes, formatDuration } from "@/lib/utils";
import { buildDumps, outputsOf, type DumpRecord } from "./run-dumps";
import { isStepSummary, SUMMARY_LINES } from "./run-steps";
import type { RunDump, RunNotification, RunOutput, RunStep, RunStepSummary, RunSummaryItem, RunUpload } from "./run-types";
import { AIR_GAP_SKIP } from "@/lib/core/air-gap";

/**
 * Every step of a backup told in a sentence or two, with a row for each database, folder,
 * destination or channel it went through. Built from the log and what the runner recorded, and
 * pure, so it is tested on plain logs. A step it knows nothing special about says its last line.
 */

export interface SummaryInput {
    entries: LogEntry[];
    steps: RunStep[];
    records: DumpRecord[];
    /** The databases the run names, for a run that recorded no dumps. */
    names: string[];
    engineVersion: string | null;
    compression: string | null;
    /** The name of the key the archive was encrypted with, or true when the name is gone. */
    encryption: string | true | null;
    uploads: RunUpload[];
    notifications: RunNotification[];
    sourceName: string | null;
    folders: number;
    size: number | null;
    /** The size of each dump in the last backup of the job. */
    previous: Map<string, number>;
    detail: string | null;
    live: boolean;
    now: number;
}

/** "a", "a and b", "a, b and c", and past four "a, b, c and 5 more". */
export function listOf(names: string[]): string {
    if (names.length <= 1) return names[0] ?? "";
    if (names.length > 4) return `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;
    return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

function plural(count: number, one: string, many = `${one}s`): string {
    return `${count} ${count === 1 ? one : many}`;
}

function match(entries: LogEntry[], pattern: RegExp): RegExpMatchArray | null {
    for (const entry of [...entries].reverse()) {
        const found = sourceOf(entry.message).text.match(pattern);
        if (found) return found;
    }
    return null;
}

function between(start: string | null, end: string | null): number | null {
    const from = start ? Date.parse(start) : NaN;
    const to = end ? Date.parse(end) : NaN;
    return Number.isFinite(from) && Number.isFinite(to) ? to - from : null;
}

/** The lines each destination or folder wrote, by the name in front of them. */
function linesOf(entries: LogEntry[], name: string): RunOutput[] {
    return outputsOf(entries.filter((entry) => sourceOf(entry.message).source === name));
}

function initializing(entries: LogEntry[], input: SummaryInput, dumps: RunDump[]): string | null {
    const listed = match(entries, /^Databases to dump: (.+)$/)?.[1].split(", ");
    const names = listed ?? (dumps.length > 0 ? dumps.map((dump) => dump.name) : input.names);
    const engine = input.engineVersion ?? match(entries, /^Detected engine version: (.+)$/)?.[1] ?? null;
    const folders = input.folders > 0 ? plural(input.folders, "folder") : null;
    const parts: string[] = [];
    if (names.length > 0) {
        parts.push(`Found ${listOf(names)} on ${input.sourceName ?? "the source"}${engine ? `, engine ${engine}` : ""}${folders ? `, and ${folders} to collect` : ""}.`);
    } else if (folders) {
        parts.push(`Found ${folders} to collect.`);
    }
    if (entries.some((entry) => /^No databases selected/.test(entry.message))) parts.push("The job picks no databases, so it backs up every one it finds.");
    return parts.length > 0 ? parts.join(" ") : null;
}

function dumping(dumps: RunDump[], live: boolean): { text: string | null; tool: string | null } {
    const tool = dumps.map((dump) => (dump.command ? parseCommand(dump.command)?.binary.split("/").at(-1) : null) ?? dump.outputs[0]?.source).find(Boolean) ?? null;
    if (dumps.length === 0) return { text: null, tool };
    const names = listOf(dumps.map((dump) => dump.name));
    const failed = dumps.filter((dump) => dump.state === "failed").map((dump) => dump.name);
    const how = tool ? " with {tool}" : "";
    const order = dumps.length > 1 ? " one after the other" : "";
    if (live) return { text: `Dumps ${names}${order}${how}.`, tool };
    if (failed.length > 0) return { text: `Could not dump ${listOf(failed)}.`, tool };
    return { text: `Dumped ${names}${how}.`, tool };
}

function collecting(entries: LogEntry[], live: boolean): { text: string | null; items: RunSummaryItem[] } {
    const items: RunSummaryItem[] = [];
    for (const entry of entries) {
        const { source, text } = sourceOf(entry.message);
        if (!source) continue;
        const done = text.match(/^Collected (\d+) file\(s\)(?: and (\d+) symlink\(s\))?, (.+)$/);
        const missing = /could not be collected/.test(text);
        const item = items.find((candidate) => candidate.key === source);
        const next: Partial<RunSummaryItem> = done
            ? { state: "done", text: `${plural(Number(done[1]), "file")}${done[2] ? ` and ${plural(Number(done[2]), "link")}` : ""}, ${done[3]}` }
            : missing ? { state: "failed", text } : {};
        if (item) Object.assign(item, next);
        else items.push({ key: source, label: source, adapterId: null, state: "running", text: "collecting", outputs: [], ...next });
    }
    for (const item of items) {
        item.outputs = linesOf(entries, item.key);
        if (item.state === "running" && !live) item.state = "failed";
    }
    const text = items.length === 0 ? null : live ? "Collects the files of each folder, one after the other." : `Collected the files of ${plural(items.length, "folder")}.`;
    return { text, items };
}

function processing(entries: LogEntry[], input: SummaryInput, dumps: RunDump[]): string | null {
    const size = match(entries, /archive created successfully\. Size: (.+)$/i)?.[1] ?? (input.size ? formatBytes(input.size) : null);
    if (!size) return null;
    const what = [dumps.length > 0 ? (dumps.length > 3 ? plural(dumps.length, "database") : listOf(dumps.map((dump) => dump.name))) : null,
        input.folders > 0 ? plural(input.folders, "folder") : null].filter(Boolean).join(" and ");
    const compression = input.compression ? { GZIP: "Gzip", BROTLI: "Brotli" }[input.compression] ?? input.compression : null;
    const encryption = input.encryption === true ? "encrypted" : input.encryption ? `encrypted with the key ${input.encryption}` : null;
    const treatment = [compression && `compressed with ${compression}`, encryption].filter(Boolean).join(" and ");
    return `Packed ${what || "everything"} into one archive of ${size}${treatment ? `, ${treatment}` : ""}.`;
}

/** A destination the run left out because it is air-gapped and was not connected. */
const isAway = (upload: RunUpload) => upload.state === "skipped" && upload.error === AIR_GAP_SKIP;

function uploadText(upload: RunUpload, uploads: RunUpload[]): string {
    if (upload.state === "failed") return upload.error ?? "failed";
    if (isAway(upload)) return "air-gapped, not connected";
    if (upload.state === "skipped") return "skipped";
    if (upload.state === "waiting") {
        const busy = uploads.find((entry) => entry.state === "uploading");
        return busy ? `waits for ${busy.name}` : "waits";
    }
    if (upload.state === "uploading") return upload.bytes !== null && upload.total ? `${Math.round((upload.bytes / upload.total) * 100)} %` : "starting";
    const took = between(upload.startedAt, upload.endedAt);
    return took !== null ? `stored in ${formatDuration(took)}` : "stored";
}

function uploading(entries: LogEntry[], input: SummaryInput): { text: string | null; items: RunSummaryItem[] } {
    const items = input.uploads.map((upload): RunSummaryItem => ({
        key: upload.configId || upload.name,
        label: upload.name,
        adapterId: upload.adapterId || null,
        state: upload.state === "uploading" ? "running" : upload.state,
        text: uploadText(upload, input.uploads),
        outputs: linesOf(entries, upload.name),
    }));
    const stored = input.uploads.filter((upload) => upload.state === "done").length;
    if (items.length === 0) return { text: null, items };
    // An air-gapped destination that was away is no copy that should be there.
    const away = input.uploads.filter(isAway).map((upload) => upload.name);
    const expected = items.length - away.length;
    const awayText = away.length > 0 ? `, ${listOf(away)} ${away.length === 1 ? "was" : "were"} not connected` : "";
    const text = input.live
        ? `Stores the archive at ${items.length > 1 ? "each destination, one after the other" : input.uploads[0].name}.`
        : stored === expected ? `Stored the archive at ${plural(stored, "destination")}${awayText}.` : `Stored the archive at ${stored} of ${plural(expected, "destination")}${awayText}.`;
    return { text, items };
}

/** One row per destination out of the lines it wrote, for the steps that report per destination in words only. */
function perDestination(entries: LogEntry[], read: (text: string) => Pick<RunSummaryItem, "state" | "text"> | null): RunSummaryItem[] {
    const items: RunSummaryItem[] = [];
    for (const entry of entries) {
        const { source, text } = sourceOf(entry.message);
        if (!source) continue;
        const found = read(text);
        if (!found) continue;
        const item = items.find((candidate) => candidate.key === source);
        if (item) Object.assign(item, found);
        else items.push({ key: source, label: source, adapterId: null, outputs: linesOf(entries, source), ...found });
    }
    return items;
}

function verifying(entries: LogEntry[]): { text: string | null; items: RunSummaryItem[] } {
    const items = perDestination(entries, (text) => {
        if (/^Integrity check passed/i.test(text)) return { state: "done", text: "matches its checksum" };
        if (/Integrity check FAILED/i.test(text)) return { state: "failed", text: "differs from what was written" };
        const skipped = text.match(/^Integrity verification skipped: (.+)$/);
        if (skipped) return { state: "skipped", text: `skipped, ${skipped[1].replace(/_/g, " ")}` };
        const error = text.match(/^Integrity verification error: (.+)$/);
        return error ? { state: "warning", text: error[1] } : null;
    });
    const text = items.length === 0 ? null : items.every((item) => item.state === "done") ? (items.length === 1 ? `The copy at ${items[0].label} matches its checksum.` : "Every copy matches its checksum.") : null;
    return { text, items };
}

function retention(entries: LogEntry[]): { text: string | null; items: RunSummaryItem[] } {
    const items = perDestination(entries, (text) => {
        if (/^Retention: No policy configured/.test(text)) return { state: "done", text: "no policy, nothing removed" };
        const kept = text.match(/^Retention: Keeping (\d+), Deleting (\d+)\./);
        if (kept) return { state: "done", text: Number(kept[2]) > 0 ? `kept ${kept[1]}, removed ${kept[2]}` : `kept all ${kept[1]}` };
        if (/^Retention: Skipped \(upload was not successful\)/.test(text)) return { state: "skipped", text: "skipped, its upload failed" };
        if (/^Retention: Skipped until it is connected/.test(text)) return { state: "skipped", text: "skipped until it is connected" };
        const error = text.match(/^Retention (?:Process )?Error[^:]*: (.+)$/);
        return error ? { state: "failed", text: error[1] } : null;
    });
    const text = items.length > 0 && items.every((item) => item.text === "no policy, nothing removed") ? "No retention policy, nothing was removed." : null;
    return { text, items };
}

function notifying(notifications: RunNotification[]): { text: string | null; items: RunSummaryItem[] } {
    const items = notifications.map((entry): RunSummaryItem => ({
        key: entry.id,
        label: entry.channelName,
        adapterId: entry.adapterId,
        state: entry.status === "Success" ? "done" : "failed",
        text: entry.status === "Success" ? "sent" : entry.error ?? "failed",
        outputs: [],
    }));
    const sent = items.filter((item) => item.state === "done").length;
    return { text: items.length === 0 ? null : sent === items.length ? `Sent to ${plural(sent, "channel")}.` : `Sent to ${sent} of ${plural(items.length, "channel")}.`, items };
}

/** The last thing a step said, for a step without a summary of its own. */
function lastLine(entries: LogEntry[]): string | null {
    const line = [...entries].reverse().find((entry) => entry.level !== "error" && entry.level !== "warning" && entry.type !== "command"
        && !SUMMARY_LINES.some((pattern) => pattern.test(entry.message)));
    return line ? sourceOf(line.message).text : null;
}

export function buildSummary(input: SummaryInput): RunStepSummary[] {
    const stepEntries = (step: string) => input.entries.filter((entry) => (entry.stage ?? "General") === step && !isStepSummary(entry));
    const dumps = buildDumps({ entries: stepEntries("Dumping Databases"), records: input.records, names: input.names, previous: input.previous, live: input.live, now: input.now });
    return input.steps.map((step): RunStepSummary => {
        const entries = stepEntries(step.name);
        const told = tell(step, entries, input, dumps);
        // A step that found nothing to tell in its own way still says what it did last.
        return told.text === null && told.items.length === 0 && told.dumps.length === 0 ? { ...told, text: lastLine(entries) } : told;
    });
}

function tell(step: RunStep, entries: LogEntry[], input: SummaryInput, dumps: RunDump[]): RunStepSummary {
    const live = input.live && step.state === "running";
    const base: RunStepSummary = { step: step.name, text: null, tool: null, dumps: [], items: [], checksum: null, now: null };
    switch (step.name) {
        case "Queued":
            return { ...base, text: step.durationMs ? `Waited ${formatDuration(step.durationMs)} for a free slot.` : null };
        case "Initializing":
            return { ...base, text: initializing(entries, input, dumps) ?? lastLine(entries) };
        case "Dumping Databases":
            return { ...base, ...dumping(dumps, live), dumps };
        case "Collecting Files":
            return { ...base, ...collecting(entries, live) };
        case "Processing":
            return { ...base, text: processing(entries, input, dumps) ?? lastLine(entries), now: live && input.detail?.startsWith("Packing") ? input.detail : null };
        case "Uploading":
            return { ...base, ...uploading(entries, input), checksum: match(entries, /^SHA-256: ([0-9a-f]{64})$/i)?.[1] ?? null };
        case "Verifying":
            return { ...base, ...verifying(entries) };
        case "Applying Retention":
            return { ...base, ...retention(entries) };
        case "Sending Notifications":
            return { ...base, ...notifying(input.notifications) };
        default:
            return base;
    }
}
