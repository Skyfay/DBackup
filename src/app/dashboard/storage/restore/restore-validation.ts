/**
 * Submit validity of the restore page, kept free of React so the rules are unit-testable.
 *
 * The rule that matters most: a database target server is only required when at least one
 * database is actually selected. Restoring only directories out of a DB+directory backup
 * is a first-class case - the old page blocked it, which was a bug.
 */

import type { ArchiveTreeSelection } from "@/components/dashboard/storage/archive-tree-selection";

export interface RestoreValidationInput {
    /** Database entries found by analysis, with their selection state. */
    dbSelections: { selected: boolean }[];
    /** Directory sources with target and file-selection state. */
    dirSelections: {
        selected: boolean;
        targetConfigId: string;
        targetPath: string;
        selection: ArchiveTreeSelection;
    }[];
    /** Whether the backup contains directory sources at all. */
    hasDirectories: boolean;
    /** Whether analysis identified individual databases. */
    analyzedDbCount: number;
    /** True for archives with no database component at all. */
    isDirectoryOnly: boolean;
    /** Chosen target database server, if any. */
    targetSourceId: string;
    /** Set when the server-side dry run rejected the selection (e.g. broken chain). */
    planError: string | null;
}

export interface RestoreValidity {
    /** v1 archives and plain dumps: nothing was analyzed, classic semantics apply. */
    classicMode: boolean;
    dbTargetNeeded: boolean;
    dbSelectionValid: boolean;
    dirSelectionValid: boolean;
    atLeastOneSelected: boolean;
    canSubmit: boolean;
}

export function computeRestoreValidity(input: RestoreValidationInput): RestoreValidity {
    const selectedDbCount = input.dbSelections.filter((d) => d.selected).length;

    // Nothing analyzable (v1 archive or plain dump): the restore is driven purely by the
    // target server, exactly as before selective restore existed.
    const classicMode = !input.hasDirectories && input.analyzedDbCount === 0 && !input.isDirectoryOnly;

    const dbTargetNeeded = classicMode || selectedDbCount > 0;
    const dbSelectionValid = !dbTargetNeeded || !!input.targetSourceId;

    const dirSelectionValid = input.dirSelections
        .filter((d) => d.selected)
        .every((d) =>
            d.targetConfigId.length > 0 &&
            d.targetPath.trim().length > 0 &&
            // An explicit empty selection means "nothing from this source" - the source
            // should be deselected instead of submitting a no-op.
            (d.selection === null || d.selection.length > 0)
        );

    const atLeastOneSelected =
        classicMode || selectedDbCount > 0 || input.dirSelections.some((d) => d.selected);

    return {
        classicMode,
        dbTargetNeeded,
        dbSelectionValid,
        dirSelectionValid,
        atLeastOneSelected,
        canSubmit: dbSelectionValid && dirSelectionValid && atLeastOneSelected && !input.planError,
    };
}
