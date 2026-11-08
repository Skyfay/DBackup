/**
 * Slash trimming that cannot backtrack.
 *
 * The obvious spellings - `/^\/+/` and `/\/+$/` - are quadratic on a run of slashes. A
 * trailing quantifier is unanchored at the start, so the engine restarts the `+` at every
 * position and backtracks through the rest each time: 40,000 slashes takes about 0.8 s, and
 * every doubling costs four times as much. That is a denial of service on any path that
 * reaches it from a request, which is why CodeQL's `js/polynomial-redos` flags them.
 *
 * These loops do the same job in one pass. Shared rather than rewritten per call site,
 * because the regex version is what everyone reaches for first.
 */

/** ASCII "/" - compared by code unit so no substring is allocated while scanning. */
const SLASH = 47;
/** ASCII "." and " ", which Windows drops at the end of a name. */
const DOT = 46;
const SPACE = 32;

/**
 * Removes the dots and spaces at the end of a name, which Windows and the storages on it drop, so
 * `Tenants. ` names the same folder as `Tenants` there. A loop for the same reason as above.
 */
export function stripTrailingDotsAndSpaces(value: string): string {
    let end = value.length;
    while (end > 0 && (value.charCodeAt(end - 1) === DOT || value.charCodeAt(end - 1) === SPACE)) end--;
    return value.slice(0, end);
}

/** Removes trailing "/" characters. */
export function stripTrailingSlashes(value: string): string {
    let end = value.length;
    while (end > 0 && value.charCodeAt(end - 1) === SLASH) end--;
    return value.slice(0, end);
}

/** Removes leading "/" characters. */
export function stripLeadingSlashes(value: string): string {
    let start = 0;
    while (start < value.length && value.charCodeAt(start) === SLASH) start++;
    return value.slice(start);
}

/** Removes leading and trailing "/" characters. */
export function stripSlashes(value: string): string {
    let start = 0;
    while (start < value.length && value.charCodeAt(start) === SLASH) start++;
    let end = value.length;
    while (end > start && value.charCodeAt(end - 1) === SLASH) end--;
    return value.slice(start, end);
}
