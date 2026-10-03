import type { RunProblemAction } from "./run-types";

/**
 * Messages DBackup, its adapters and the dump tools write when something goes wrong, each told
 * in plain words with what to do about it. A message no entry knows keeps its raw line and a
 * title that names the step, so nothing is hidden.
 */

export interface ProblemContext {
    /** The destination, database or channel the line is about, when it names one. */
    subject: string | null;
    step: string;
    jobName: string | null;
    /** What the subject is, which decides the connection a button opens. */
    subjectKind: "destination" | "source" | "channel" | null;
    subjectId?: string;
}

export interface ProblemText {
    title: string;
    help: string | null;
    actions: RunProblemAction[];
    /** A known warning that needs no action, like a note of the dump tool. */
    harmless?: boolean;
}

interface KnownProblem {
    test: RegExp;
    describe: (context: ProblemContext, match: RegExpMatchArray) => ProblemText;
}

function subjectOr(context: ProblemContext, fallback: string): string {
    return context.subject ?? fallback;
}

/** The button that opens the connection a problem is about. */
function connection(context: ProblemContext): RunProblemAction[] {
    if (!context.subjectKind) return [];
    const label = { destination: "Open destination", source: "Open source", channel: "Open channel" }[context.subjectKind];
    return [{ kind: context.subjectKind, id: context.subjectId, label }];
}

function job(context: ProblemContext): RunProblemAction[] {
    return context.jobName ? [{ kind: "job", label: "Open job" }] : [];
}

// The order matters: the first entry whose pattern matches describes the line.
const KNOWN: KnownProblem[] = [
    {
        test: /bot was blocked by the user/i,
        describe: (context) => ({
            title: "Telegram blocked the bot",
            help: "Unblock the bot in Telegram, or pick another chat for the channel.",
            actions: connection(context),
        }),
    },
    {
        test: /quota[^.]*exceeded|storage quota|no space left|ENOSPC|disk (is )?full|insufficient (storage|space)|not enough (free )?space|out of (disk )?space/i,
        describe: (context) => ({
            title: `${subjectOr(context, "The destination")} is full`,
            help: `Free space there, or give ${context.jobName ?? "the job"} another destination.`,
            actions: [...connection(context), ...job(context)],
        }),
    },
    {
        test: /circular foreign-key constraints? on (this|these) tables?:?\s*([\w".]+)?/i,
        describe: (_context, match) => ({
            title: match[2] ? `Circular foreign keys in ${match[2].replace(/"/g, "")}` : "Circular foreign keys",
            help: "Nothing is missing from the dump. A restore into an empty database handles it, only a restore of single tables needs care.",
            actions: [],
            harmless: true,
        }),
    },
    {
        // The dump step leaves out what the login of a MySQL or MariaDB source may not read.
        test: /^(Events|Stored procedures and functions) of (.+?) left out: the login may not read/,
        describe: (context, match) => ({
            title: match[1] === "Events" ? `The events of ${match[2]} are not in the backup` : `Routines of ${match[2]} are not in the backup`,
            help: match[1] === "Events"
                ? "The login may not read them. Grant it EVENT on the database, or turn off Events in the Options of the source."
                : "The login may not read their code. Grant it SHOW_ROUTINE on MySQL 8.0.20 and later or SELECT on mysql.proc on older servers, or turn off Stored procedures and functions in the Options of the source.",
            actions: connection(context),
        }),
    },
    {
        test: /You do not have the SUPER privilege and binary logging is enabled/i,
        describe: (context) => ({
            title: "The server refuses triggers and functions from this login",
            help: "With binary logging on, MySQL lets only a login with SUPER create triggers and stored functions. Restore with such a login, or set log_bin_trust_function_creators to 1 on the server.",
            actions: connection(context),
        }),
    },
    {
        test: /you need \(at least one of\) the (SUPER|SET USER|SET_USER_ID|SET_ANY_DEFINER)\b[^)]*privilege/i,
        describe: (context) => ({
            title: "The backup holds objects of another user",
            help: "Its triggers, views or routines name another user as their definer. Restore with a login that has SUPER, SET_ANY_DEFINER or SET_USER_ID on MySQL, or SET USER on MariaDB.",
            actions: connection(context),
        }),
    },
    {
        test: /permission denied for (table|schema|database|relation|sequence)|must be owner of|insufficient privilege/i,
        describe: (context) => ({
            title: "The login may not read everything",
            help: "Give the login of the connection the rights to read every table, or back up with a login that has them.",
            actions: connection(context),
        }),
    },
    {
        test: /password authentication failed|authentication failed|access denied for user|login failed for user|invalid (credentials|password|username)|wrong ?pass(word)?|\b401\b|unauthori[sz]ed/i,
        describe: (context) => ({
            title: `${subjectOr(context, "The server")} refused the login`,
            help: "Check the user and password of the connection, or its credential profile.",
            actions: connection(context),
        }),
    },
    {
        test: /timeout expired|timed out|ETIMEDOUT|ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENOTFOUND|getaddrinfo|could not connect|connection refused|connection (was )?(lost|reset|closed)|network is unreachable/i,
        describe: (context) => ({
            title: `Could not reach ${subjectOr(context, "the server")}`,
            help: "Check that it runs and that DBackup can reach its host and port.",
            actions: connection(context),
        }),
    },
    {
        test: /\b403\b|forbidden|access denied/i,
        describe: (context) => ({
            title: `${subjectOr(context, "The server")} refused it`,
            help: "The account or token may not do this. Check its permissions.",
            actions: connection(context),
        }),
    },
    {
        test: /NoSuchBucket|bucket does not exist|no such (file|directory|container)|\b404\b|not found/i,
        describe: (context) => ({
            title: `${subjectOr(context, "The destination")} has no such place`,
            help: "Check the bucket, folder or path of the connection.",
            actions: connection(context),
        }),
    },
    {
        test: /checksum (mismatch|does not match)|integrity check failed|expected: .* got: /i,
        describe: (context) => ({
            title: `The copy at ${subjectOr(context, "the destination")} differs`,
            help: "The file there is not what was written. Run the job again, or restore from another copy.",
            actions: connection(context),
        }),
    },
    {
        test: /is a history table for the .* updatable ledger table/i,
        describe: () => ({
            title: "History tables of ledger tables are left out",
            help: "A BACPAC holds the current rows of a ledger table, not its history. The data is all there, restored tables only prove nothing about earlier changes.",
            actions: [],
            harmless: true,
        }),
    },
    {
        test: /GENERATED ALWAYS column\) in a ledger table/i,
        describe: () => ({
            title: "Generated always columns of ledger tables are left out",
            help: "SQL Server fills them again when the rows are written, so a restore works without them.",
            actions: [],
            harmless: true,
        }),
    },
    {
        test: /ledger data in system views will not be captured/i,
        describe: () => ({
            title: "The ledger views are left out",
            help: "A BACPAC does not carry what the system views say about the ledger.",
            actions: [],
            harmless: true,
        }),
    },
    {
        test: /uses Ledger tables\. A BACPAC cannot capture/i,
        describe: () => ({
            title: "This database uses ledger tables",
            help: "Its tamper evidence is not part of a BACPAC. Keep a copy made on the server if that evidence matters.",
            actions: [],
            harmless: true,
        }),
    },
    {
        test: /BACPAC export is not transactionally consistent/i,
        describe: (context) => ({
            title: "The export is not consistent while the database is written to",
            help: "Stop writes while it runs, or export from a copy made with CREATE DATABASE ... AS COPY OF.",
            actions: connection(context),
        }),
    },
    {
        test: /server version mismatch|aborting because of server version mismatch|newer version backup/i,
        describe: () => ({
            title: "The versions do not match",
            help: "The tools in DBackup and the server have different versions. Update DBackup, or restore onto a server of the same version or a newer one.",
            actions: [],
        }),
    },
];

/** The plain words of a line an entry knows, or null. */
export function knownProblem(message: string, context: ProblemContext): ProblemText | null {
    for (const entry of KNOWN) {
        const match = message.match(entry.test);
        if (match) return entry.describe(context, match);
    }
    return null;
}

/** The plain words of a line, or a title that names the step for a line no entry knows. */
export function describeProblem(message: string, tone: "error" | "warning", context: ProblemContext): ProblemText {
    const known = knownProblem(message, context);
    if (known) return known;
    const step = context.step.toLowerCase();
    if (context.subject) {
        return { title: tone === "error" ? `${context.subject} failed` : `A warning from ${context.subject}`, help: null, actions: connection(context) };
    }
    return { title: tone === "error" ? `Failed while ${step}` : `A warning while ${step}`, help: null, actions: [] };
}
