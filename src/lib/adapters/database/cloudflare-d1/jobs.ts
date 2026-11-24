import { AdapterError } from "@/lib/logging/errors";
import { d1Request, databaseIdOf, isPermissionRefusal, type D1Connection } from "./api";
import { downloadTo, measure, signedUrlOf, uploadFrom, type ImportBody } from "./transfer";

/**
 * The export and the import of D1, both long running work that Cloudflare does on its side and
 * that is polled until it ends.
 *
 * An export that is not polled is cancelled by Cloudflare, so the loop never waits long between
 * two polls. Both lock the database while they run: it serves no queries until they end.
 */

/** The pause between two polls. Cloudflare holds a poll for a moment itself. */
const POLL_PAUSE_MS = 1_000;

/** No export or import runs longer than this. */
const MAX_DURATION_MS = 6 * 60 * 60 * 1000;

/** How often a poll that failed on the way is tried again, with a pause that doubles each time. */
const POLL_RETRIES = 5;

type Log = (message: string, level?: "info" | "warning" | "error") => void;

interface PollAnswer {
    status?: string;
    at_bookmark?: string;
    error?: string;
    messages?: string[];
    upload_url?: string;
    filename?: string;
    result?: {
        signed_url?: string;
        filename?: string;
        num_queries?: number;
        final_bookmark?: string;
        meta?: { rows_written?: number; duration?: number; size_after?: number };
    };
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A line of Cloudflare for the run log, without any URL, which could be a signed one. */
function relay(answer: PollAnswer, log: Log): void {
    for (const line of answer.messages ?? []) {
        if (typeof line === "string" && line.trim()) log(`Cloudflare: ${line.trim().replace(/https?:\/\/\S+/gi, "[URL]")}`);
    }
}

/** Whether a failed call is worth another try: the network, a rate limit or a server error, not a refusal. */
function isTransient(error: unknown): boolean {
    if (isPermissionRefusal(error)) return false;
    const status = (error as { context?: { status?: number } })?.context?.status;
    return status === undefined || status === 429 || status >= 500;
}

/** One poll, tried again a few times when it fails on the way, since the work at Cloudflare goes on. */
async function poll(config: D1Connection, operation: string, path: string, body: unknown, log: Log): Promise<PollAnswer> {
    for (let attempt = 0; ; attempt++) {
        try {
            return (await d1Request<PollAnswer>(config, operation, "POST", path, body)).result;
        } catch (error: unknown) {
            if (attempt >= POLL_RETRIES || !isTransient(error)) throw error;
            const wait = 2_000 * 2 ** attempt;
            log(`Polling the ${operation} failed, trying again in ${wait / 1000} s`, "warning");
            await pause(wait);
        }
    }
}

/** A failed export in words a person can act on. */
function exportFailure(error: string | undefined): string {
    const text = error?.trim() || "Cloudflare did not say why.";
    if (/virtual table/i.test(text)) {
        return `${text} Cloudflare cannot export a database that holds a virtual table, like an FTS5 search index. Drop the virtual tables before the backup and create them again after it, or leave this database out of the job.`;
    }
    return `The export failed: ${text}`;
}

/**
 * Exports one database to a SQL dump at `destinationPath`. Answers its size.
 *
 * The dump is what Cloudflare writes for an import into D1 (`compatibility: "d1"`): schema and
 * data, `PRAGMA defer_foreign_keys=TRUE` at the top, no transaction statements.
 */
export async function exportDatabase(config: D1Connection, uuid: string, destinationPath: string, log: Log): Promise<number> {
    const id = databaseIdOf(uuid);
    const path = `/d1/database/${id}/export`;
    const started = Date.now();

    let answer: PollAnswer;
    try {
        ({ result: answer } = await d1Request<PollAnswer>(config, "export", "POST", path, { output_format: "polling" }));
    } catch (error: unknown) {
        if (isPermissionRefusal(error)) {
            throw new AdapterError("cloudflare-d1", "export", "Cloudflare refused the export. The API token needs the permission D1 Edit, D1 Read is not enough to export.");
        }
        throw error;
    }
    relay(answer, log);

    while (answer.status !== "complete" && answer.status !== "error") {
        if (Date.now() - started > MAX_DURATION_MS) {
            throw new AdapterError("cloudflare-d1", "export", "The export did not finish within 6 hours.");
        }
        if (!answer.at_bookmark) {
            throw new AdapterError("cloudflare-d1", "export", `Cloudflare answered the export with the status "${answer.status ?? "none"}" and no bookmark to poll.`);
        }
        await pause(POLL_PAUSE_MS);
        answer = await poll(config, "export", path, { output_format: "polling", current_bookmark: answer.at_bookmark }, log);
        relay(answer, log);
    }

    if (answer.status === "error") {
        throw new AdapterError("cloudflare-d1", "export", exportFailure(answer.error));
    }

    const url = signedUrlOf(answer.result?.signed_url, "export");
    log(`Downloading the export from ${url.hostname}`);
    return downloadTo(url, destinationPath);
}

/** What an import reports when it ends. */
export interface ImportOutcome {
    queries?: number;
    rowsWritten?: number;
    finalBookmark?: string;
}

/**
 * Whether an import failed in a way that leaves open what Cloudflare did: it was handed over and
 * then the polling broke off. Cloudflare may still finish it, so a database made for it stays.
 */
export function importMayContinue(error: unknown): boolean {
    return (error as { context?: { importMayContinue?: boolean } })?.context?.importMayContinue === true;
}

/**
 * Imports SQL into one database: start, upload, ingest, poll. The body is a dump file, with SQL
 * put ahead of it when the restore replaces a database.
 *
 * D1 runs the whole body in one transaction, so a failed import leaves the database as it was. A
 * body Cloudflare already holds (the same MD5) needs no upload, `init` then starts the import
 * itself and answers its state right away.
 */
export async function importDatabase(config: D1Connection, uuid: string, body: ImportBody, log: Log): Promise<ImportOutcome> {
    const id = databaseIdOf(uuid);
    const path = `/d1/database/${id}/import`;
    const started = Date.now();
    const { etag, size } = await measure(body);

    let { result: answer } = await d1Request<PollAnswer>(config, "import", "POST", path, { action: "init", etag });

    if (answer.upload_url) {
        const url = signedUrlOf(answer.upload_url, "import");
        log(`Uploading the dump to ${url.hostname}`);
        await uploadFrom(url, body, etag, size);
        if (typeof answer.filename !== "string" || !answer.filename) {
            throw new AdapterError("cloudflare-d1", "import", "Cloudflare answered the import without a file name.");
        }
        ({ result: answer } = await d1Request<PollAnswer>(config, "import", "POST", path, { action: "ingest", etag, filename: answer.filename }));
    } else {
        log("Cloudflare already holds this dump, the import starts without an upload");
    }
    relay(answer, log);

    try {
        while (answer.status !== "complete" && answer.status !== "error") {
            if (Date.now() - started > MAX_DURATION_MS) {
                throw new AdapterError("cloudflare-d1", "import", "The import did not finish within 6 hours.");
            }
            if (!answer.at_bookmark) {
                throw new AdapterError("cloudflare-d1", "import", `Cloudflare answered the import with the status "${answer.status ?? "none"}" and no bookmark to poll.`);
            }
            await pause(POLL_PAUSE_MS);
            answer = await poll(config, "import", path, { action: "poll", current_bookmark: answer.at_bookmark }, log);
            relay(answer, log);
        }
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message.replace(/^\[cloudflare-d1\] [a-z-]+: /, "") : String(error);
        throw new AdapterError(
            "cloudflare-d1",
            "import",
            `Lost track of the import, Cloudflare may still finish it: ${message} Check the database in the Cloudflare dashboard before restoring again.`,
            { context: { importMayContinue: true } },
        );
    }

    if (answer.status === "error") {
        const reason = answer.error?.trim() || "Cloudflare did not say why.";
        const tooLong = /TOOBIG|too long/i.test(reason)
            ? " D1 takes no statement over 100 KB, and the export writes each row as one statement, so a row with a text over about 100 KB or a BLOB over about 50 KB cannot be imported back into D1."
            : "";
        throw new AdapterError("cloudflare-d1", "import", `The import failed and the database was left as it was: ${reason}${tooLong}`);
    }

    return {
        queries: answer.result?.num_queries,
        rowsWritten: answer.result?.meta?.rows_written,
        finalBookmark: answer.result?.final_bookmark,
    };
}
