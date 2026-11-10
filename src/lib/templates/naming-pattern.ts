/**
 * A naming pattern names one file, the archive of a run inside the folder of that run. A `/` or a
 * `\` would lead out of it, a control character breaks the name, and a leading dot hides the file
 * or makes it `..`. Saving a template refuses such a pattern, and the runner reduces a name it
 * resolves to one safe part anyway, for a pattern saved before the rule, see `safeFileName`.
 */

/** What someone reads whose naming pattern names more than one file. */
export const NAMING_PATTERN_RULE = "A naming pattern names one file, so it cannot hold a slash, a backslash or a control character, or start with a dot.";

const UNSAFE = /[\\/\x00-\x1f\x7f]/;

/** Why a naming pattern names no single file, or null when it names one. */
export function namingPatternProblem(pattern: string): string | null {
    return UNSAFE.test(pattern) || pattern.startsWith(".") ? NAMING_PATTERN_RULE : null;
}

/**
 * A resolved name as one part of a path: every slash, backslash and control character becomes
 * `_`, and so do the dots it starts with. `fallback` stands in for a name with nothing left.
 */
export function safeFileName(name: string, fallback: string): string {
    const safe = name.replace(/[\\/\x00-\x1f\x7f]/g, "_").replace(/^\.+/, (dots) => "_".repeat(dots.length));
    return safe.trim() === "" ? fallback : safe;
}
