/**
 * Who wrote a line of a run, what a command in the log holds, and what kind of thing a line
 * says. Pure, so the page of a run and the service behind it read the log the same way.
 */

/** Tools that put their name in front of their lines with a colon instead of brackets. */
const COLON_SOURCES = ["SqlPackage", "SQL Server"];

/** The time a tool writes into its own lines, which the log already shows in front of them. */
const TOOL_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\s+/;

export interface LineSource {
    /** The tool, destination or source the line comes from, like mongodump or NAS Backups. */
    source: string | null;
    text: string;
}

/** `[mongodump] 2026-09-27T17:00:27.406+0200 writing ...` comes from mongodump and says `writing ...`. */
export function sourceOf(message: string): LineSource {
    const bracket = message.match(/^\[([^\][\n]{1,60})\]\s*([\s\S]*)$/);
    if (bracket) return { source: bracket[1], text: bracket[2].replace(TOOL_TIME, "") };
    for (const name of COLON_SOURCES) {
        if (message.startsWith(`${name}: `)) return { source: name, text: message.slice(name.length + 2).replace(TOOL_TIME, "") };
    }
    return { source: null, text: message };
}

export interface CommandArg {
    /** The option, with the `=` or `:` that joins it to its value when it has one. */
    flag: string | null;
    value: string | null;
}

export interface ParsedCommand {
    binary: string;
    args: CommandArg[];
}

const FLAG = /^-{1,2}[A-Za-z]/;
const SLASH_FLAG = /^\/[A-Za-z][\w.]*:/;

/** A command line split into its program and its options, each option with its value. */
export function parseCommand(line: string): ParsedCommand | null {
    // A quoted part belongs to the word around it, like --name="a b" or /Name:'a b'.
    const parts = line.trim().match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
    const [binary, ...rest] = parts;
    if (binary === undefined) return null;
    const args: CommandArg[] = [];
    for (let index = 0; index < rest.length; index++) {
        const part = rest[index];
        const joined = part.match(/^(-{1,2}[A-Za-z][\w-]*=)([\s\S]*)$/) ?? part.match(/^(\/[A-Za-z][\w.]*:)([\s\S]*)$/);
        if (joined) {
            args.push({ flag: joined[1], value: joined[2] });
        } else if (FLAG.test(part)) {
            const next = rest[index + 1];
            if (next !== undefined && !FLAG.test(next) && !SLASH_FLAG.test(next)) {
                args.push({ flag: part, value: next });
                index += 1;
            } else {
                args.push({ flag: part, value: null });
            }
        } else {
            args.push({ flag: null, value: part });
        }
    }
    return { binary, args };
}

/** Whether a command is a statement for the server, like the BACKUP DATABASE of SQL Server. */
export function isStatement(text: string): boolean {
    return /^\s*(BACKUP|RESTORE|SELECT|ALTER|CREATE|DROP|USE|EXEC|DBCC)\b/i.test(text);
}

/** A statement broken before its clauses, the way it would be written by hand. */
export function statementLines(text: string): { indent: number; text: string }[] {
    const clauses = text.trim().replace(/\s+/g, " ").split(/ (?=(?:TO|FROM) (?:DISK|URL)\b|WITH\b)/i);
    return clauses.flatMap((clause, index) => {
        if (index === 0) return [{ indent: 0, text: clause }];
        const pieces = clause.split(/, (?=NAME\s*=|MOVE\s)/i);
        return pieces.map((piece, position) => ({ indent: position === 0 ? 1 : 2, text: position < pieces.length - 1 ? `${piece},` : piece }));
    });
}

/**
 * What a line says with its names and numbers taken out, so lines that say the same thing about
 * other tables or columns count as one kind.
 */
export function kindOf(text: string): string {
    return text
        .replace(/\[[^\]]*\]/g, "[]")
        .replace(/'[^']*'|"[^"]*"/g, "''")
        .replace(/\b[0-9a-f]{8,}\b/gi, "#")
        .replace(/\d+/g, "#")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
}

/** The first sentence of a line, short enough for a title. */
export function firstSentence(text: string, max = 90): string {
    const sentence = text.trim().split(/(?<=[.!?])\s/)[0] ?? text;
    const short = sentence.replace(/\[[^\]]{24,}\]/g, (whole) => `${whole.slice(0, 18)}…]`);
    return short.length > max ? `${short.slice(0, max - 1).trimEnd()}…` : short.replace(/\.$/, "");
}
