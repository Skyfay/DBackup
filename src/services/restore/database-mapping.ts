import { ValidationError } from "@/lib/logging/errors";

/** Which database of a backup to restore, and under which name. */
export interface DatabaseMappingEntry {
    originalName: string;
    targetName: string;
    selected: boolean;
}

/**
 * Brings a restore request's `databaseMapping` into the one shape the restore code reads.
 *
 * The restore page sends a list of entries. The API reference also documents a plain object
 * of renames, `{ "shop": "shop_copy" }`. Every reader downstream only understands the list, so
 * an object used to be ignored, which restored every database of the backup under its
 * original name while the preflight had checked the new names. Converting it here keeps both
 * forms meaning the same thing: an object selects exactly the databases it names.
 *
 * Anything else is refused rather than guessed at, because a mapping that silently falls back
 * to "restore everything" is how a restore overwrites databases nobody asked for.
 */
export function normalizeDatabaseMapping(mapping: unknown): DatabaseMappingEntry[] | undefined {
    if (mapping === undefined || mapping === null) return undefined;

    if (Array.isArray(mapping)) {
        return mapping.map((entry, index) => {
            const candidate = entry as Partial<Record<keyof DatabaseMappingEntry, unknown>> | null;
            if (!candidate || typeof candidate.originalName !== "string" || candidate.originalName.length === 0) {
                throw new ValidationError(`databaseMapping[${index}] needs an originalName`, { field: "databaseMapping" });
            }
            if (candidate.targetName !== undefined && typeof candidate.targetName !== "string") {
                throw new ValidationError(`databaseMapping[${index}].targetName must be a string`, { field: "databaseMapping" });
            }
            return {
                originalName: candidate.originalName,
                targetName: candidate.targetName || candidate.originalName,
                // Only an explicit true selects, as it always has. An entry without it is
                // listed but not restored.
                selected: candidate.selected === true,
            };
        });
    }

    if (typeof mapping === "object") {
        return Object.entries(mapping as Record<string, unknown>).map(([originalName, targetName]) => {
            if (typeof targetName !== "string") {
                throw new ValidationError(`databaseMapping.${originalName} must be a string`, { field: "databaseMapping" });
            }
            return { originalName, targetName: targetName || originalName, selected: true };
        });
    }

    throw new ValidationError("databaseMapping must be a list of entries or an object of renames", { field: "databaseMapping" });
}
