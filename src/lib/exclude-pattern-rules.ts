/**
 * What an exclude pattern may look like, and the matcher for the plain ones.
 *
 * Patterns are matched in the one server process that also answers every request and runs the
 * backups of every tenant, against names that come from the server a source points at. A glob
 * library turns a pattern into a regular expression that backtracks: `*a*a*a*a*a*a*a*b` against a
 * long run of `a` holds the process for many seconds per name. So a plain pattern never reaches the
 * library, and a richer one only in a shape whose cost stays small.
 */

import { braceExpand } from "minimatch";

/** The most patterns one source or one preset holds. */
export const MAX_EXCLUDE_PATTERNS = 500;
/** The longest pattern. */
export const MAX_EXCLUDE_PATTERN_LENGTH = 1000;
/** The most `*` one part of a path holds in a pattern the glob library matches. */
const MAX_STARS = 2;
const MAX_BRACE_GROUPS = 4;
const MAX_BRACE_COMMAS = 16;
/**
 * The most patterns one with braces stands for, counted the way the glob library expands it, so
 * nested braces count fully: `{a,b}{c,d}` is four. Each becomes a regular expression of its own.
 */
const MAX_ALTERNATIVES = 16;
/** The most patterns all the patterns of one list that are not plain stand for together. */
export const MAX_LIST_ALTERNATIVES = 256;

/** The patterns a pattern with braces stands for, the pattern itself without braces. */
function alternativesOf(pattern: string): string[] {
    return pattern.includes("{") ? braceExpand(pattern) : [pattern];
}

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

/**
 * The most runs of `*` in one part of a path of any pattern the pattern stands for, where a part
 * that is `**` alone counts for none. A brace can hold a `/`, so the parts are read after expanding.
 */
function mostStars(alternatives: readonly string[]): number {
    let most = 0;
    for (const alternative of alternatives) {
        for (const part of alternative.split("/")) {
            if (part === "**") continue;
            most = Math.max(most, part.match(/\*+/g)?.length ?? 0);
        }
    }
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
    const alternatives = alternativesOf(pattern);
    if (alternatives.length > MAX_ALTERNATIVES) return `The exclude pattern "${shown}" has too many alternatives in braces.`;
    if (mostStars(alternatives) > MAX_STARS) {
        return `The exclude pattern "${shown}" has more than ${MAX_STARS} "*" in one part of its path. Only a pattern without "/", brackets and braces takes more.`;
    }
    return null;
}

/** How many patterns a pattern that is not plain stands for, none for a plain one, which never becomes a regular expression. */
function costOf(pattern: string): number {
    return isPlainPattern(pattern) ? 0 : alternativesOf(pattern).length;
}

/** Why a list of patterns is refused, or null. */
export function excludePatternsProblem(patterns: readonly unknown[]): string | null {
    if (patterns.length > MAX_EXCLUDE_PATTERNS) return `A list holds at most ${MAX_EXCLUDE_PATTERNS} exclude patterns.`;
    let cost = 0;
    for (const pattern of patterns) {
        if (typeof pattern !== "string") return "An exclude pattern is text.";
        const problem = excludePatternProblem(pattern);
        if (problem) return problem;
        cost += costOf(pattern);
    }
    if (cost > MAX_LIST_ALTERNATIVES) return `The exclude patterns of a list stand for more than ${MAX_LIST_ALTERNATIVES} patterns with "/", brackets or braces together. Keep fewer of them, or use plain ones like "*.tmp".`;
    return null;
}

/**
 * The patterns of a list a run uses, and those it leaves out with why. A pattern saved before the
 * rules of today is left out rather than failing the whole backup, and so is what lies past the
 * bound of a list, since the patterns of a source and its presets come together only at the run.
 */
export function usableExcludePatterns(patterns: readonly unknown[]): { usable: string[]; skipped: { pattern: string; reason: string }[] } {
    const usable: string[] = [];
    const skipped: { pattern: string; reason: string }[] = [];
    let cost = 0;
    for (const pattern of patterns) {
        if (typeof pattern !== "string") {
            skipped.push({ pattern: String(pattern), reason: "An exclude pattern is text." });
            continue;
        }
        const problem = usable.length >= MAX_EXCLUDE_PATTERNS ? `A list holds at most ${MAX_EXCLUDE_PATTERNS} exclude patterns.` : excludePatternProblem(pattern);
        const next = cost + costOf(pattern);
        if (problem || next > MAX_LIST_ALTERNATIVES) {
            skipped.push({ pattern, reason: problem ?? `The exclude patterns stand for more than ${MAX_LIST_ALTERNATIVES} patterns with "/", brackets or braces together.` });
            continue;
        }
        cost = next;
        usable.push(pattern);
    }
    return { usable, skipped };
}
