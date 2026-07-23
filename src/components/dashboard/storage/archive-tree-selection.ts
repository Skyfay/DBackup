/**
 * Selection model of the archive file tree, kept free of React so the intricate part -
 * splitting a covered ancestor when one of its descendants is unchecked - is unit-testable.
 *
 * `null` means "everything" (the default, and what a restore request without a path list
 * expresses). An array holds inclusively selected paths, where a directory path covers
 * everything beneath it. There is deliberately no exclusion form ("all except X"): the
 * restore API only accepts inclusive paths, so exclusions are materialised by replacing a
 * covered ancestor with its explicit siblings.
 */

export type ArchiveTreeSelection = string[] | null;

/** The minimum a tree level has to know about its entries. */
export interface TreeLevelEntry {
    path: string;
}

export function isAncestor(ancestor: string, descendant: string): boolean {
    return descendant.startsWith(`${ancestor}/`);
}

/** Ancestor prefixes of a path, outermost first: "a/b/c" -> ["a", "a/b"]. */
export function ancestorsOf(path: string): string[] {
    const parts = path.split("/");
    return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join("/"));
}

/** True when the path itself or one of its ancestors is selected. */
export function isCovered(selection: ArchiveTreeSelection, path: string): boolean {
    if (selection === null) return true;
    return selection.some((s) => s === path || isAncestor(s, path));
}

/** True when something beneath the path is selected - the "indeterminate" checkbox state. */
export function hasCoveredDescendant(selection: ArchiveTreeSelection, path: string): boolean {
    if (selection === null) return true;
    return selection.some((s) => isAncestor(path, s));
}

/**
 * Unchecks a node that is currently covered.
 *
 * When the coverage comes from an ancestor (or from "everything"), that coverage is split:
 * walking from the covering ancestor down to the target, the siblings of the path become
 * explicitly selected and the target is left out. Every level on that walk is present in
 * `levels`, because the user had to expand it to reach the node being unchecked.
 */
function uncheck(
    selection: ArchiveTreeSelection,
    target: string,
    levels: Record<string, TreeLevelEntry[]>
): string[] {
    let cover: string | undefined;
    if (selection === null) {
        cover = "";
    } else {
        cover = [...ancestorsOf(target)].reverse().find((a) => selection.includes(a));
    }

    // Covered only by its own explicit entry: plain removal, nothing to split.
    if (selection !== null && cover === undefined) {
        return selection.filter((s) => s !== target);
    }

    const next = (selection ?? []).filter((s) => s !== target && s !== cover);

    const chain = cover === ""
        ? ["", ...ancestorsOf(target)]
        : ancestorsOf(target).filter((a) => a === cover || isAncestor(cover!, a));

    for (const prefix of chain) {
        for (const entry of levels[prefix] ?? []) {
            if (entry.path === target || isAncestor(entry.path, target)) continue;
            next.push(entry.path);
        }
    }

    return [...new Set(next)];
}

/**
 * Toggles one node.
 *
 * Checking a node swallows any explicitly selected descendants and merges upwards: when
 * every loaded sibling of a level is covered, the level collapses into its parent, and at
 * the root into `null` ("everything"). That makes uncheck-then-recheck a true round trip
 * back to the cheap whole-source request form, instead of accumulating an ever longer
 * path list that means the same thing.
 */
export function toggleSelection(
    selection: ArchiveTreeSelection,
    target: string,
    levels: Record<string, TreeLevelEntry[]>
): ArchiveTreeSelection {
    if (isCovered(selection, target)) {
        return uncheck(selection, target, levels);
    }

    let next = (selection ?? []).filter((s) => s !== target && !isAncestor(target, s));
    next.push(target);

    // Merge upwards, deepest level first. Only loaded levels can be judged, which is
    // enough: the levels along the target's path are loaded by construction.
    const chain = ["", ...ancestorsOf(target)];
    for (let i = chain.length - 1; i >= 0; i--) {
        const prefix = chain[i];
        const entries = levels[prefix];
        if (!entries || entries.length === 0) break;
        if (!entries.every((e) => isCovered(next, e.path))) break;

        next = next.filter((s) => !entries.some((e) => s === e.path || isAncestor(e.path, s)));
        if (prefix === "") return null;
        if (!next.includes(prefix)) next.push(prefix);
    }

    return next;
}
