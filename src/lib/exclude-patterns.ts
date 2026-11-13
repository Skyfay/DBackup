import { Minimatch } from "minimatch";
import { ValidationError } from "@/lib/logging/errors";
import { stripTrailingSlashes } from "@/lib/paths";
import { excludePatternProblem, isPlainPattern, matchPlainPattern } from "./exclude-pattern-rules";

/**
 * Compiled patterns keyed by their source string, since a source's exclude list is matched
 * against every file it walks - a tree with 100k entries otherwise recompiles the same handful
 * of globs 100k times over. Unbounded, but bounded in practice by how many distinct pattern
 * strings ever appear across a process's lifetime, which is a handful per job. Emptied once it
 * holds more than any honest set of jobs fills, so patterns nobody uses twice do not pile up.
 */
const compiled = new Map<string, Minimatch>();
const MAX_COMPILED = 5000;

/**
 * The compiled form of a pattern that is not plain. Only a pattern in a shape with a small cost
 * gets one, see `excludePatternProblem`. A save refuses any other and a run checks its patterns
 * before it reads, so this throws only for a caller that skipped both.
 */
function getCompiled(pattern: string): Minimatch {
    let mm = compiled.get(pattern);
    if (!mm) {
        const problem = excludePatternProblem(pattern);
        if (problem) throw new ValidationError(problem);
        if (compiled.size >= MAX_COMPILED) compiled.clear();
        mm = new Minimatch(pattern, { dot: true, matchBase: true });
        compiled.set(pattern, mm);
    }
    return mm;
}

/** The last part of a path that is not empty, the name a slash-free pattern is matched against. */
function baseName(relativePath: string): string {
    let end = relativePath.length;
    while (end > 0 && relativePath[end - 1] === "/") end--;
    return relativePath.slice(relativePath.lastIndexOf("/", end - 1) + 1, end);
}

/**
 * One pattern against one path. A plain pattern, the usual kind, is matched here in linear time
 * and never becomes a regular expression that backtracks. The names `.` and `..` and an empty one
 * keep the rules of the glob library, which no wildcard matches.
 */
function matchOne(relativePath: string, pattern: string): boolean {
    if (isPlainPattern(pattern)) {
        const name = baseName(relativePath);
        if (name !== "" && name !== "." && name !== "..") return matchPlainPattern(name, pattern);
    }
    return getCompiled(pattern).match(relativePath);
}

/**
 * Returns true if relativePath matches any of the given glob patterns.
 *
 * matchBase lets a slash-free pattern (e.g. "*.tmp") match against the basename at any depth,
 * while a pattern containing a slash (e.g. "cache/**") matches the full relative path.
 *
 * Lives in its own module because both the collection path (which applies exclusions) and the
 * summary that reports them need it - having the summary import from the adapter layer would
 * make the two depend on each other in a circle.
 */
export function matchesAnyExcludePattern(relativePath: string, patterns?: string[]): boolean {
    if (!patterns || patterns.length === 0) return false;
    return patterns.some((pattern) => matchesExcludePattern(relativePath, pattern));
}

/**
 * Whether one pattern matches one path. Same rules as above, for callers attributing a match.
 * Throws a ValidationError for a pattern `excludePatternProblem` refuses.
 */
export function matchesExcludePattern(relativePath: string, pattern: string): boolean {
    return pattern.trim().length > 0 && matchOne(relativePath, pattern);
}

/** A stand-in path segment no real file is named, used to ask a pattern about hypothetical contents. */
const PROBE_SEGMENT = "__dbackup_probe__";

/** How many levels below a directory are probed before it is considered fully excluded. */
const PROBE_DEPTH = 3;

/**
 * The pattern proving nothing under `relativeDirPath` could be kept, or undefined.
 *
 * Lets a walk skip a directory instead of listing it. That is the difference between a
 * source with a `node_modules` in it taking minutes and taking hours, because exclusions are
 * otherwise applied to a listing that has already been paid for.
 *
 * Answered by probing: the directory is prunable when a single pattern excludes a
 * hypothetical file directly inside it, one a level deeper, and one deeper still. Two rules
 * make that safe, and both were arrived at by finding the cases that break without them:
 *
 * - **One pattern must cover every depth.** `dir/*` and `dir/*\/*` together cover the first
 *   two levels, but a file three levels down is still wanted. Accepting a different pattern
 *   per depth would drop it.
 * - **A pattern matching the directory's own path counts for nothing.** `matchBase` means a
 *   slash-free pattern matches a basename at any depth, so `*.log` matches a *directory*
 *   named `foo.log` while `foo.log/notes.txt` is not excluded at all. The same holds for a
 *   bare `node_modules`, which today excludes nothing inside itself. Pruning on self-match
 *   would quietly remove those files from the backup.
 *
 * Not a proof for an adversarial glob, so it errs in the only direction it may: failing to
 * prune costs one directory listing, pruning wrongly costs files nobody notices are missing
 * until they are needed.
 */
export function canPruneDirectory(relativeDirPath: string, patterns?: string[]): string | undefined {
    if (!patterns || patterns.length === 0) return undefined;

    const base = stripTrailingSlashes(relativeDirPath);
    if (!base) return undefined;

    return patterns.find((pattern) => {
        if (pattern.trim().length === 0) return false;
        for (let depth = 1; depth <= PROBE_DEPTH; depth++) {
            const probe = `${base}/${Array<string>(depth).fill(PROBE_SEGMENT).join("/")}`;
            if (!matchOne(probe, pattern)) return false;
        }
        return true;
    });
}
