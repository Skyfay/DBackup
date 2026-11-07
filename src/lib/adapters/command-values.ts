import { AdapterError } from "@/lib/logging/errors";

/**
 * Checks for the values of a connection config that an adapter puts into a string another program
 * splits or parses itself: the `-e` command of rsync, `user@host:path`, the `host/port:path` of
 * Firebird, an option file. Inside such a string a space, a line break, a `:` or a leading `-`
 * stops being part of the value and becomes another word, another host or another option of the
 * program, which runs on the server DBackup runs on in direct mode.
 *
 * The adapter checks them itself right before it builds the string, also for a config stored by an
 * earlier version that never went through the check on save, see `config-check.ts`. A plain module,
 * the form schemas, the check on save and the adapters read it.
 */

/** A character below 0x20 or DEL, which no host, login or port holds. */
const CONTROL = /[\x00-\x1f\x7f]/;

/** Whether a text holds a control character, a line break or a NUL among them. */
export function hasControlCharacter(value: string): boolean {
    return CONTROL.test(value);
}

/**
 * Whether a value is a port, a whole number from 1 to 65535, written as a number or as text like
 * `"3306"` from an older form. A missing, empty or `0` port counts too, the adapters read it as their
 * default and the forms store `0` for a port left empty.
 */
export function isPortOrDefault(value: unknown): boolean {
    if (value === undefined || value === null || value === "") return true;
    const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
    return /^\d{1,5}$/.test(text) && Number(text) <= 65535;
}

/** What someone reads whose port is none, see `isPortOrDefault`. */
export const PORT_HINT = "The port must be a whole number from 1 to 65535.";

/**
 * The port of a config as a number, the fallback for a missing, empty or `0` one.
 *
 * @throws AdapterError for anything else, like `22 -o ProxyCommand=...`, `1.5` or `70000`.
 */
export function validPort(value: unknown, adapterId: string, fallback: number): number {
    if (!isPortOrDefault(value)) throw new AdapterError(adapterId, "config", PORT_HINT);
    const port = value === undefined || value === null || value === "" ? 0 : Number(String(value).trim());
    return port === 0 ? fallback : port;
}

/** What someone reads whose host is no plain host, see `plainHostProblem`. */
export const PLAIN_HOST_HINT = "The host must be a plain host name or address, without spaces, a leading hyphen, @, : or /. Write an IPv6 address in brackets, like [2001:db8::1].";

/**
 * Why a host cannot be one word of a command line or the host part of `user@host:path`, null when
 * it can: it is missing, holds whitespace or a control character, starts with `-`, which a program
 * reads as an option, holds an `@`, which moves the host to after it, or a `:`, `/` or `\` outside
 * the brackets of an IPv6 address, since those end the host part of `user@host:path` and of
 * Firebird's `host/port:path`.
 */
export function plainHostProblem(value: unknown): string | null {
    const host = typeof value === "string" ? value.trim() : "";
    if (!host) return "The host is missing.";
    const bracketed = /^\[[0-9A-Za-z:.%]+\]$/.test(host);
    if (
        host.startsWith("-")
        || hasControlCharacter(host)
        || /\s/.test(host)
        || host.includes("@")
        || (!bracketed && /[:/\\[\]]/.test(host))
    ) {
        return PLAIN_HOST_HINT;
    }
    return null;
}

/**
 * The host of a config once it is a plain host, see `plainHostProblem`, without the spaces around it.
 *
 * @throws AdapterError saying why, never naming the value.
 */
export function plainHost(value: unknown, adapterId: string): string {
    const problem = plainHostProblem(value);
    if (problem) throw new AdapterError(adapterId, "config", problem);
    return (value as string).trim();
}
