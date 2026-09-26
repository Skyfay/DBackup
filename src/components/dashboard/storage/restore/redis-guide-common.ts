/**
 * What the Bash and the PowerShell commands of the Redis restore guide share: the input, the
 * marks of the values filled in, and how a value becomes one word of a command.
 */

export type RedisEngine = "Redis" | "Valkey";

/** Where Redis runs, which decides how it is stopped, started and reached. */
export type RedisHost = "docker" | "compose" | "service" | "windows";

export interface RedisGuideInput {
    engine: RedisEngine;
    host: RedisHost;
    /** The container, the compose service, or the service of systemd or Windows. */
    target: string;
    /** Where Redis keeps its dump, on the host or inside the container. */
    dataDir: string;
    /** Whether Redis asks for a password, which the commands then ask for first. */
    password: boolean;
    /** The one-time download link, null until it is made. */
    url: string | null;
    /** Whether the link ran out, which marks it amber like a missing one. */
    urlExpired?: boolean;
    /** What comes back, for the comment on top, like "Cache nightly of 24 Sep 2026, 02:00". */
    backup: string;
}

/** A value to notice in the code, amber while it is missing and green once it is filled in. */
export interface GuideMark {
    text: string;
    tone: "warning" | "success";
}

export interface GuideCode {
    code: string;
    marks: GuideMark[];
}

/** One step by hand. Each block is pasted on its own, so a prompt never reads the next line. */
export interface GuideStep {
    title: string;
    text: string;
    blocks: GuideCode[];
}

const MISSING_LINK = "<make the link in DBackup first>";
const MISSING_DIR = "<data folder>";
const MISSING_TARGET: Record<RedisHost, string> = { docker: "<container>", compose: "<service>", service: "<service>", windows: "<service>" };

/** A folder as Redis reports it, without a separator at the end. */
function folder(dataDir: string, windows: boolean): string {
    const trimmed = dataDir.trim();
    if (windows) return /^[A-Za-z]:\\?$/.test(trimmed) ? trimmed : trimmed.replace(/[\\/]+$/, "");
    return trimmed.length > 1 ? trimmed.replace(/\/+$/, "") : trimmed;
}

/** Everything the commands of one guide share, with the marks the code collects. */
export function guideParts(input: RedisGuideInput) {
    const marks: GuideMark[] = [];
    const mark = (text: string, tone: GuideMark["tone"]) => {
        if (!marks.some((existing) => existing.text === text)) marks.push({ text, tone });
    };
    const target = input.target.trim();
    const dataDir = folder(input.dataDir, input.host === "windows");
    const url = input.url ?? MISSING_LINK;
    mark(url, input.url && !input.urlExpired ? "success" : "warning");
    if (!target) mark(MISSING_TARGET[input.host], "warning");
    if (!dataDir) mark(MISSING_DIR, "warning");

    /** A value for a variable of the script, marked green, or the amber placeholder in its place. */
    const variable = (value: string, missing: string, quote: (text: string) => string) => {
        if (!value) return quote(missing);
        mark(quote(value), "success");
        return quote(value);
    };

    return {
        marks,
        lower: input.engine.toLowerCase(),
        target,
        dataDir,
        url,
        missingTarget: MISSING_TARGET[input.host],
        missingDir: MISSING_DIR,
        variable,
        /** Keeps the marks that appear in this piece of code. */
        code: (code: string): GuideCode => ({ code, marks: marks.filter((each) => code.includes(each.text)) }),
    };
}

/** Commands with a comment each, the comments lined up. */
export function commented(rows: [string, string][]): string {
    const width = Math.max(...rows.map(([command]) => command.length));
    return rows.map(([command, comment]) => `${command.padEnd(width)}   # ${comment}`).join("\n");
}
