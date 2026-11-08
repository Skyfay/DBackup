import type { z } from "zod";
import { backupPathProblem } from "@/lib/tenant/storage-view";

/**
 * Refines the path of a backup in a request schema with the rule of `assertBackupPath`: no empty
 * path, none from the root of the storage and no `..` part, also between backslashes or behind
 * percent escapes. Its sentence becomes the 400 the route answers.
 *
 * @example
 * ```typescript
 * const Schema = z.object({ file: z.string().min(1).superRefine(backupPathIssue) });
 * ```
 */
export function backupPathIssue(value: string, ctx: z.RefinementCtx): void {
    const problem = backupPathProblem(value);
    if (problem) ctx.addIssue({ code: "custom", message: problem });
}
