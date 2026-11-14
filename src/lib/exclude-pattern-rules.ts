/**
 * What an exclude pattern may look like, and the matcher for the plain ones.
 *
 * Patterns are matched in the one server process that also answers every request and runs the
 * backups of every tenant, against names that come from the server a source points at. A glob
 * library turns a pattern into a regular expression that backtracks: `*a*a*a*a*a*a*a*b` against a
 * long run of `a` holds the process for many seconds per name. So a plain pattern never reaches the
 * library, and a richer one only in a shape whose cost stays small.
 */

/** The most patterns one source or one preset holds. */
export const MAX_EXCLUDE_PATTERNS = 500;
/** The longest pattern. */
export const MAX_EXCLUDE_PATTERN_LENGTH = 1000;
/** The most `*` one part of a path holds in a pattern the glob library matches. */
const MAX_STARS = 2;
const MAX_BRACE_GROUPS = 4;
const MAX_BRACE_COMMAS = 16;

/**
 * Whether a pattern is plain: one name of literal characters, `*` and `?`, with no `/`, class,
 * brace, escape or leading `!` or `#`. `*.tmp` and `*~` are, `cache/**` and `*.log.[0-9]*` are not.
 */
export function isPlainPattern(pattern: string): boolean {
    return !/[/\\[\]{}()]/.test(pattern) && !pattern.startsWith("!") && !pattern.startsWith("#");
}

/**
 * Matches a plain pattern against one name in a time that grows with the name times the pattern,
 * whatever the two are. It steps back only to the last `*`, never to an earlier one.
 */
export function matchPlainPattern(name: string, pattern: string): boolean {
    let n = 0;
    let p = 0;
    let star = -1;
    let mark = 0;
    while (n < name.length) {
        if (p < pattern.length && pattern[p] === "*") {
            star = p++;
            mark = n;
        } else if (p < pattern.length && (pattern[p] === "?" || pattern[p] === name[n])) {
            n++;
            p++;
        } else if (star !== -1) {
            p = star + 1;
            n = ++mark;
        } else {
            return false;
        }
    }
    while (p < pattern.length && pattern[p] === "*") p++;
    return p === pattern.length;
}

/** The most runs of `*` in one part of the pattern, where a part that is `**` alone counts for none. */
function mostStars(pattern: string): number {
    const parts = pattern.split("/").filter((part) => part !== "**");
    // A brace can hold a `/`, so the parts of such a pattern are only known once it is expanded.
    const counted = pattern.includes("{") ? [parts.join("/")] : parts;
    let most = 0;
    for (const part of counted) most = Math.max(most, part.match(/\*+/g)?.length ?? 0);
    return most;
}

/**
 * Why a pattern is refused, as a sentence for the user, or null for a pattern that may be saved
 * and matched. A plain pattern is never refused for its shape, see `matchPlainPattern`.
 */
export function excludePatternProblem(pattern: string): string | null {
    const shown = pattern.length > 60 ? `${pattern.slice(0, 60)}...` : pattern;
    if (pattern.length > MAX_EXCLUDE_PATTERN_LENGTH) return `The exclude pattern "${shown}" is longer than ${MAX_EXCLUDE_PATTERN_LENGTH} characters.`;
    if (isPlainPattern(pattern)) return null;
    if (/[@!+?*]\(/.test(pattern)) return `The exclude pattern "${shown}" uses a group like "+(...)", which is not supported.`;
    if (/\{[^{}]*\.\.[^{}]*\}/.test(pattern)) return `The exclude pattern "${shown}" uses a range like "{1..9}", which is not supported.`;
    if ((pattern.match(/\{/g)?.length ?? 0) > MAX_BRACE_GROUPS || (pattern.match(/,/g)?.length ?? 0) > MAX_BRACE_COMMAS) {
        return `The exclude pattern "${shown}" has too many alternatives in braces.`;
    }
    if (mostStars(pattern) > MAX_STARS) {
        return `The exclude pattern "${shown}" has more than ${MAX_STARS} "*" in one part of its path. Only a pattern without "/", brackets and braces takes more.`;
    }
    return null;
}

/** Why a list of patterns is refused, or null. */
export function excludePatternsProblem(patterns: readonly unknown[]): string | null {
    if (patterns.length > MAX_EXCLUDE_PATTERNS) return `A list holds at most ${MAX_EXCLUDE_PATTERNS} exclude patterns.`;
    for (const pattern of patterns) {
        if (typeof pattern !== "string") return "An exclude pattern is text.";
        const problem = excludePatternProblem(pattern);
        if (problem) return problem;
    }
    return null;
}
