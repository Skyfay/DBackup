/**
 * Serialization for the archive index.
 *
 * Wire shape: NDJSON -> gzip -> (sealed with the archive's index subkey when encrypted).
 *
 * NDJSON rather than a JSON array because the index scales with file count, not data size:
 * half a million files is roughly 80 MB of JSON, and `JSON.parse` on that needs about a
 * gigabyte of heap. One object per line streams in constant memory instead.
 */

import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { createGzip, createGunzip } from "zlib";
import { StringDecoder } from "string_decoder";
import { openEntry, sealEntry, INDEX_ORDINAL } from "@/lib/crypto/entry-cipher";
import { ArchiveIndex, entryKey, IndexEntryLine, IndexLine } from "./types";
import { assertIndexStoredSize, DamagedBackupError, INDEX_MAX_LIST_ITEMS, indexTextLimit } from "./limits";

/**
 * Why the path of a file line is no plain path below the folder of its source, or null when it is.
 *
 * The writer only ever stores plain relative paths. The index comes from the destination though,
 * and its readers do not all read a path alike: the checks of symbolic links (`link-target.ts`)
 * count the parts as written, while `safeRemoteJoin` and `path.resolve` resolve a `..` inside it,
 * so `a/../b` would be checked at one place and written at another. A path with an empty, `.` or
 * `..` part, or a leading separator, is therefore refused with the whole index. The parts are
 * split at `\` as well, since every destination of DBackup and the link checks read it as a
 * separator.
 */
export function entryPathProblem(entryPath: unknown): string | null {
    if (typeof entryPath !== "string" || entryPath === "") return "a file without a path";
    if (entryPath.includes("\0")) return "a path with a NUL character";
    if (entryPath.startsWith("/") || entryPath.startsWith("\\")) return "an absolute path";
    if (entryPath.split("/").some((part) => part === "" || part === "." || part === "..")) return "a path with an empty, '.' or '..' part";
    if (entryPath.split(/[\\/]/).some((part) => part === "." || part === "..")) return "a path with a '.' or '..' part";
    return null;
}

/** Whether a value is a count or an offset: a whole number from 0 up to `Number.MAX_SAFE_INTEGER`. */
function isCount(value: unknown): value is number {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * The number fields of each line kind, those it always has and those it may have. Every reader
 * bound rests on them: `s` caps the inflation of an entry and the temporary space of a restore,
 * `off` and `size` the bytes a read fetches, `o` and `l` the slice of a bundle. A string, a
 * negative, a fraction or a number past the safe range there would turn the bound off.
 */
const NUMBER_FIELDS: Partial<Record<IndexLine["k"], { required: readonly string[]; optional: readonly string[] }>> = {
    e: { required: ["n", "off", "size"], optional: [] },
    db: { required: ["n", "s"], optional: [] },
    f: { required: ["s"], optional: ["n", "o", "l"] },
};

/**
 * Why the numbers of an index line cannot be trusted, or null when they can. Each field of
 * `NUMBER_FIELDS` is a whole number of at least 0 where it is present, and present where the
 * line needs it.
 */
export function lineNumbersProblem(line: { k?: unknown } & Record<string, unknown>): string | null {
    // An own key only, so a kind named like `toString` reads no property every object has.
    if (typeof line.k !== "string" || !Object.hasOwn(NUMBER_FIELDS, line.k)) return null;
    const fields = NUMBER_FIELDS[line.k as IndexLine["k"]];
    if (!fields) return null;
    for (const field of fields.required) {
        if (!isCount(line[field])) return `a '${line.k}' line whose '${field}' is no whole number of at least 0`;
    }
    for (const field of fields.optional) {
        if (line[field] !== undefined && !isCount(line[field])) return `a '${line.k}' line whose '${field}' is no whole number of at least 0`;
    }
    return null;
}

/**
 * What the writer writes into a field: a string, a number, a boolean flag, or a list of strings.
 * Only `excludePatterns` of a `d` line and `archives` of a `deps` line are lists.
 */
type FieldType = "string" | "number" | "boolean" | "strings";

/**
 * The fields of each line kind with the type the writer gives them, in the order it writes them. A
 * line keeps only these, so whatever else a crafted index carries on its lines is dropped as it is
 * read instead of staying in memory with the parsed index, in the cache of every tenant. A field of
 * the wrong type refuses the index: a small index whose fields hold empty objects or lists would
 * otherwise inflate to tens of millions of objects, which the cache, weighing by the text, never
 * sees. Every field of a line type is listed, so a new one fails the type check until it is here.
 */
const LINE_FIELDS: { readonly [K in IndexLine["k"]]: { readonly [F in keyof Extract<IndexLine, { k: K }>]-?: FieldType } } = {
    h: { k: "string", v: "number", createdAt: "string", archive: "string" },
    deps: { k: "string", archives: "strings" },
    e: { k: "string", n: "number", a: "string", member: "string", off: "number", size: "number", sealed: "boolean", comp: "string", bundle: "boolean" },
    db: { k: "string", name: "string", format: "string", n: "number", s: "number", h: "string" },
    d: { k: "string", src: "string", label: "string", fileCount: "number", totalSize: "number", excludePatterns: "strings" },
    f: {
        k: "string", src: "string", p: "string", s: "number", m: "string", h: "string", lnk: "string",
        n: "number", a: "string", o: "number", l: "number", mo: "number", u: "number", g: "number",
    },
};

/** Whether a value has the type the writer gives a field, a list of at most `INDEX_MAX_LIST_ITEMS` strings for a list. */
function hasFieldType(value: unknown, type: FieldType): boolean {
    if (type !== "strings") return typeof value === type;
    return Array.isArray(value) && value.length <= INDEX_MAX_LIST_ITEMS && value.every((item) => typeof item === "string");
}

/**
 * The line with only the fields of its kind, or null for a kind no writer writes.
 *
 * @throws DamagedBackupError for a field of its kind whose value is not of the type the writer
 *   gives it, a `null` included
 */
export function knownLineFields(line: Record<string, unknown>): IndexLine | null {
    if (typeof line.k !== "string" || !Object.hasOwn(LINE_FIELDS, line.k)) return null;
    const fields = LINE_FIELDS[line.k as IndexLine["k"]] as Readonly<Record<string, FieldType>>;
    const kept: Record<string, unknown> = {};
    for (const [field, type] of Object.entries(fields)) {
        if (!Object.hasOwn(line, field) || line[field] === undefined) continue;
        if (!hasFieldType(line[field], type)) {
            throw new DamagedBackupError(`its index holds a '${line.k}' line whose '${field}' is no ${type === "strings" ? `list of at most ${INDEX_MAX_LIST_ITEMS} strings` : type}`);
        }
        kept[field] = line[field];
    }
    return kept as unknown as IndexLine;
}

/** The bytes of NDJSON each parsed index inflated to, for a cache that bounds what it holds. */
const inflatedSizes = new WeakMap<ArchiveIndex, number>();

/** How many bytes of NDJSON an index from `parseIndex` inflated to, undefined for one built otherwise. */
export function indexTextBytes(index: ArchiveIndex): number | undefined {
    return inflatedSizes.get(index);
}

/** Crypto parameters for the index, omitted for unencrypted archives. */
export interface IndexSealing {
    indexKey: Buffer;
    noncePrefix: Buffer;
}

/**
 * Serializes index lines to their on-disk representation.
 *
 * @param lines - Header line first, then entries, databases, directories and files
 * @param sealing - Present when the archive is encrypted
 */
export async function serializeIndex(lines: IndexLine[], sealing?: IndexSealing): Promise<Buffer> {
    const source = Readable.from(
        (function* () {
            for (const line of lines) yield `${JSON.stringify(line)}\n`;
        })()
    );

    const stages: NodeJS.ReadWriteStream[] = [createGzip()];
    if (sealing) {
        stages.push(sealEntry(sealing.indexKey, sealing.noncePrefix, INDEX_ORDINAL));
    }

    const chunks: Buffer[] = [];
    await pipeline(source, ...(stages as [NodeJS.ReadWriteStream]), async function* (result) {
        for await (const chunk of result) chunks.push(chunk as Buffer);
    });

    return Buffer.concat(chunks);
}

/**
 * Parses an index from its on-disk representation.
 *
 * A tampered or wrong-key index surfaces as a thrown authentication error rather than
 * partial output, so a caller can never act on a half-decrypted file list.
 *
 * @param bytes - Raw index bytes, from the sidecar or the archive's index member
 * @param sealing - Present when the archive is encrypted
 */
export async function parseIndex(bytes: Buffer, sealing?: IndexSealing): Promise<ArchiveIndex> {
    // Every bound of `limits.ts` holds before a byte is inflated or a line is kept, since the
    // index comes from the destination and a few KB of it could inflate to gigabytes.
    assertIndexStoredSize(bytes.length);
    const stages: NodeJS.ReadWriteStream[] = [];
    if (sealing) {
        stages.push(openEntry(sealing.indexKey, sealing.noncePrefix, INDEX_ORDINAL));
    }
    stages.push(createGunzip(), indexTextLimit(bytes.length));

    const index: ArchiveIndex = {
        header: { k: "h", v: 2, createdAt: "", archive: "" },
        entries: new Map<string, IndexEntryLine>(),
        databases: [],
        directories: [],
        files: [],
        deps: [],
    };

    let sawHeader = false;
    let textBytes = 0;

    const take = (line: string) => {
        if (line.length === 0) return;
        const raw = JSON.parse(line) as unknown;
        if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new DamagedBackupError("its index holds a line that is no object");
        const numbers = lineNumbersProblem(raw as Record<string, unknown>);
        if (numbers) throw new DamagedBackupError(`its index holds ${numbers}`);
        // A kind no writer writes is skipped, as it always was, and a known one keeps its own fields.
        const parsed = knownLineFields(raw as Record<string, unknown>);
        if (!parsed) return;
        switch (parsed.k) {
            case "h":
                index.header = parsed;
                sawHeader = true;
                break;
            case "deps":
                // The chain checks and the restore read the list, so a line without one is damaged.
                if (!parsed.archives) throw new DamagedBackupError("its index holds a 'deps' line without its archives");
                index.deps = parsed.archives;
                break;
            case "e":
                index.entries.set(entryKey(parsed.a, parsed.n), parsed);
                break;
            case "db":
                index.databases.push(parsed);
                break;
            case "d":
                // The chain planner compares the patterns with those of the job, so a line without them is damaged.
                if (!parsed.excludePatterns) throw new DamagedBackupError("its index holds a 'd' line without its exclude patterns");
                index.directories.push(parsed);
                break;
            case "f": {
                const problem = entryPathProblem(parsed.p);
                if (problem) throw new DamagedBackupError(`its index names ${problem}`);
                index.files.push(parsed);
                break;
            }
        }
    };

    // Lines are split here rather than by `readline`: a line that throws inside a `for await` over
    // a `readline` interface also surfaces as an uncaught exception, which would take the process
    // of every tenant down with one damaged index. `indexTextLimit` keeps the held rest below
    // the longest line.
    await pipeline(
        Readable.from([bytes]),
        ...(stages as [NodeJS.ReadWriteStream]),
        async function* (decoded) {
            const decoder = new StringDecoder("utf8");
            let rest = "";
            for await (const chunk of decoded as AsyncIterable<Buffer>) {
                textBytes += chunk.length;
                const lines = (rest + decoder.write(chunk)).split("\n");
                rest = lines.pop() ?? "";
                for (const line of lines) take(line.endsWith("\r") ? line.slice(0, -1) : line);
            }
            take(rest + decoder.end());
        }
    );

    if (!sawHeader) {
        throw new Error("Archive index is missing its header line");
    }

    inflatedSizes.set(index, textBytes);
    return index;
}

/** Flattens a parsed index back into lines, preserving the canonical order. */
export function indexToLines(index: ArchiveIndex): IndexLine[] {
    return [
        index.header,
        ...(index.deps.length > 0 ? [{ k: "deps" as const, archives: index.deps }] : []),
        ...[...index.entries.values()].sort((a, b) => (a.a ?? "").localeCompare(b.a ?? "") || a.n - b.n),
        ...index.databases,
        ...index.directories,
        ...index.files,
    ];
}
