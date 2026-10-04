import { z } from "zod";

/**
 * How a delete goes, as the delete actions accept it: into Recently deleted, or with `permanently`
 * at once and for good.
 */
export const DeleteModeSchema = z.object({ permanently: z.boolean().optional() }).strict().default({});

export type DeleteMode = z.input<typeof DeleteModeSchema>;

/** The answer to a permanent delete from someone without `TRASH_ADMIN_PERMISSION`. */
export const PERMANENT_DELETE_REFUSED = "Deleting permanently needs the right to change the settings.";

/** `?permanently=true` on a DELETE request, the same choice for the routes. */
export function permanentlyFrom(searchParams: URLSearchParams): boolean {
    return searchParams.get("permanently") === "true";
}
