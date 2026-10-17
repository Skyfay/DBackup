import type { LogEntry } from "@/lib/core/logs";
import { parseCommand } from "@/lib/logs/line-source";
import { compareVersions, formatBytes, formatDuration } from "@/lib/utils";
import type { RestoreRecord } from "@/services/restore/restore-record";
import { files as fileCount, restoreDumps, restoreFolders } from "./restore-rows";
import { isStepSummary } from "./run-steps";
import { lastLine, listOf, plural } from "./run-summary";
import type { RunDump, RunStep, RunStepState, RunStepSummary, RunSummaryItem } from "./run-types";

/**
 * Every step of a restore told in a sentence or two, like the steps of a backup: what it restores
 * from which backup onto which server, where it read from and how much, and a row for every
 * database and folder with where it went. Built from the log and the record the restore kept, see
 * `restore-record.ts`, and pure, so it is tested on plain logs. A customer's run names no archive or
 * destination of the server, since neither its record nor its log holds one.
 */

export interface RestoreSummaryInput {
    entries: LogEntry[];
    steps: RunStep[];
    record: RestoreRecord | null;
    /** The server it restores onto. */
    target: { name: string; adapterId: string | null } | null;
    /** The tenant a provider's run restores for, null for every other run. */
    customer: string | null;
    /** A customer's run of a restore of a shared database. */
    shared: boolean;
    live: boolean;
    now: number;
}

const ITEM_STATE: Partial<Record<RunStepState, RunSummaryItem["state"]>> = { done: "done", warning: "warning", failed: "failed", running: "running" };

/** The program the databases were restored with, never a row's own lines, which go by its name. */
function toolOf(dumps: RunDump[]): string | null {
    return dumps.map((dump) => (dump.command ? parseCommand(dump.command)?.binary.split("/").at(-1) : null)
        ?? dump.outputs.find((output) => output.source !== dump.name)?.source).find(Boolean) ?? null;
}

function folderWords(record: RestoreRecord | null): string | null {
    const folders = record?.folders ?? [];
    if (folders.length === 0) return null;
    return folders.length === 1 ? `the folder ${folders[0].label}` : plural(folders.length, "folder");
}

function initializing(input: RestoreSummaryInput, dumps: RunDump[]): { text: string | null; file: string | null } {
    const record = input.record;
    const what = [dumps.length > 0 ? listOf(dumps.map((dump) => dump.name)) : null, folderWords(record)].filter(Boolean).join(" and ");
    if (!what) return { text: null, file: null };
    const file = record?.archive ? record.archive.split("/").at(-1) ?? record.archive : null;
    const from = file ? " from {file}" : input.shared ? " from its backup" : "";
    const onto = dumps.length > 0 && input.target ? ` onto ${input.target.name}${record?.targetVersion ? `, engine ${record.targetVersion}` : ""}` : "";
    const renamed = dumps.filter((dump) => dump.target && dump.target !== dump.name);
    const renames = renamed.length > 0 ? ` ${listOf(renamed.map((dump, index) => `${dump.name}${index === 0 ? " goes" : ""} to ${dump.target}`))}.` : "";
    return { text: `Restores ${what}${input.customer ? ` for ${input.customer}` : ""}${from}${onto}.${renames}`, file };
}

function versions(record: RestoreRecord): string | null {
    const { backupVersion: backup, targetVersion: target } = record;
    if (!backup) return null;
    if (!target) return `The backup is of version ${backup}.`;
    const order = compareVersions(backup, target);
    if (order === 0) return `The backup is of version ${backup}, the same as the target.`;
    return order > 0
        ? `The backup is of version ${backup}, newer than the target ${target}, which may fail.`
        : `The backup is of version ${backup}, the target runs ${target}.`;
}

function downloading(step: RunStep, entries: LogEntry[], input: RestoreSummaryInput, dumps: RunDump[]): { text: string | null; items: RunSummaryItem[] } {
    const record = input.record;
    if (!record || record.ranged === null) return { text: null, items: [] };
    const read = record.read > 0 ? formatBytes(record.read) : null;
    const amount = read ? `, ${read}${input.live ? " so far" : ""}` : "";
    // A customer's run names no destination of the server.
    const from = input.shared ? null : record.from;
    let text: string;
    if (!record.ranged) {
        text = `Fetched the backup${from ? ` from ${from.name}` : ""} once in full${amount}.`;
    } else {
        const files = record.folders.length > 0 ? `the files of ${plural(record.folders.length, "folder")}` : null;
        const what = dumps.length === 1 && !files ? `only the dump of ${dumps[0].name}` : [dumps.length > 0 ? `the ${plural(dumps.length, "dump")}` : null, files].filter(Boolean).join(" and ");
        text = `Read ${what || "what it restores"}${from ? ` from the archive at ${from.name}` : ""}${amount}, without a full download.`;
    }
    const version = versions(record);
    if (version) text = `${text} ${version}`;
    if (!from) return { text, items: [] };
    const took = step.durationMs !== null ? ` in ${formatDuration(step.durationMs)}` : "";
    return {
        text,
        items: [{
            key: "from",
            label: from.name,
            adapterId: from.adapterId || null,
            state: ITEM_STATE[step.state] ?? "waiting",
            text: read ? `${record.ranged ? "read" : "fetched"} ${read}${took}` : `opened${took}`,
            outputs: entries.length > 0 ? [{ source: from.name, lines: entries.map((entry) => ({ at: entry.timestamp, level: entry.level, type: entry.type, message: entry.message, details: entry.details })) }] : [],
        }],
    };
}

function restoring(dumps: RunDump[], live: boolean): { text: string | null; tool: string | null } {
    const tool = toolOf(dumps);
    if (dumps.length === 0) return { text: null, tool };
    const how = tool ? " with {tool}" : "";
    const names = listOf(dumps.map((dump) => dump.name));
    if (live) {
        const done = dumps.filter((dump) => dump.state === "done").length;
        return { text: dumps.length === 1 ? `Restores ${names}${how}.` : `Restores ${plural(dumps.length, "database")}${how}, ${done} done.`, tool };
    }
    const failed = dumps.filter((dump) => dump.state !== "done").map((dump) => dump.name);
    if (failed.length === dumps.length) return { text: `Could not restore ${listOf(failed)}.`, tool };
    if (failed.length > 0) {
        return { text: `Restored ${dumps.length - failed.length} of ${plural(dumps.length, "database")}${how}. ${listOf(failed)} ${failed.length === 1 ? "was" : "were"} not restored.`, tool };
    }
    return { text: `Restored ${names}${how}.`, tool };
}

function restoringFiles(record: RestoreRecord | null, live: boolean): string | null {
    const folders = record?.folders ?? [];
    if (folders.length === 0) return null;
    const restored = folders.reduce((sum, folder) => sum + folder.files, 0);
    const total = folders.reduce((sum, folder) => sum + folder.total, 0);
    const what = folderWords(record)!;
    if (live) return `Restores the files of ${what}, ${restored.toLocaleString("en-US")} of ${total.toLocaleString("en-US")} so far.`;
    if (folders.every((folder) => folder.state === "done")) {
        return folders.length === 1
            ? `Restored the folder ${folders[0].label} with ${fileCount(restored)}${folders[0].target ? ` to ${folders[0].target}` : ""}.`
            : `Restored ${plural(folders.length, "folder")} with ${fileCount(restored)}.`;
    }
    const short = folders.filter((folder) => folder.state !== "done").map((folder) => folder.label);
    return `Restored ${restored.toLocaleString("en-US")} of ${fileCount(total)} of ${what}. ${listOf(short)} ${short.length === 1 ? "is" : "are"} not complete.`;
}

export function buildRestoreSummary(input: RestoreSummaryInput): RunStepSummary[] {
    const stepEntries = (step: string) => input.entries.filter((entry) => (entry.stage ?? "General") === step && !isStepSummary(entry));
    const dumps = restoreDumps({ entries: stepEntries("Restoring Databases"), record: input.record, shared: input.shared, live: input.live, now: input.now });
    return input.steps.map((step): RunStepSummary => {
        const entries = stepEntries(step.name);
        const live = input.live && step.state === "running";
        const base: RunStepSummary = { step: step.name, text: null, tool: null, file: null, dumps: [], items: [], checksum: null, now: null };
        let told: RunStepSummary = base;
        if (step.name === "Initializing") told = { ...base, ...initializing(input, dumps) };
        else if (step.name === "Downloading") told = { ...base, ...downloading(step, entries, input, dumps) };
        else if (step.name === "Restoring Databases") told = { ...base, ...restoring(dumps, live), dumps };
        else if (step.name === "Restoring Files") told = { ...base, text: restoringFiles(input.record, live), items: restoreFolders(entries, input.record) };
        // A step that found nothing to tell in its own way still says what it did last.
        return told.text === null && told.items.length === 0 && told.dumps.length === 0 ? { ...told, text: lastLine(entries) } : told;
    });
}
