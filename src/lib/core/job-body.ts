import { z } from "zod";
import { ValidationError } from "@/lib/logging/errors";

/**
 * The body of the job routes. Every field that names another record is a string, or null where the
 * link may be cleared, and nothing else. A JSON object in its place, like `{ "set": "<id>" }`, is a
 * write Prisma understands on a foreign key, and one that no check of the linked record ever read.
 * The service keeps its own rules for names, schedules and sources, this only fixes the shapes.
 */
const id = z.string().min(1);
const clearableId = z.string().nullable();

const destination = z.object({
    configId: id,
    priority: z.number().int().optional(),
    retention: z.unknown().optional(),
    retentionPolicyId: clearableId.optional(),
});

const source = z.object({
    configId: id,
    priority: z.number().int().optional(),
    path: z.string(),
    // The routes drop a value that is no list, as they always did, so only the entries are checked, by `idList` and `textList`.
    excludePatterns: z.unknown().optional(),
    excludePatternPresetIds: z.unknown().optional(),
    stopContainers: z.unknown().optional(),
});

const JobBody = z
    .object({
        name: z.string(),
        schedule: z.string(),
        sourceId: clearableId,
        databases: z.unknown(),
        destinations: z.array(destination),
        sources: z.array(source).nullable(),
        notificationIds: z.array(id),
        notificationTemplateIds: z.unknown(),
        enabled: z.boolean(),
        encryptionProfileId: clearableId,
        compression: z.string(),
        pgCompression: z.string(),
        notificationEvents: z.string(),
        namingTemplateId: clearableId,
        schedulePresetId: clearableId,
        skipVerification: z.boolean(),
        backupMode: z.string(),
        fullEveryDays: z.number().int(),
        verifyByHash: z.boolean(),
    })
    .partial();

export type JobBody = z.infer<typeof JobBody>;

/** A list of ids as a route forwards it: the list when every entry is a string, undefined when it is no list. */
export function idList(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined;
    if (value.some((entry) => typeof entry !== "string")) throw new ValidationError("A list of ids holds a value that is no id.");
    return value as string[];
}

/** A list of strings as a route forwards it, with the rule of `idList` and an empty list for no list. */
export function textList(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    if (value.some((entry) => typeof entry !== "string")) throw new ValidationError("A list holds a value that is no text.");
    return value as string[];
}

/**
 * Reads the body of a job request, or throws the ValidationError the route answers 400 with.
 *
 * @example
 * ```typescript
 * const body = parseJobBody(await req.json());
 * ```
 */
export function parseJobBody(raw: unknown): JobBody {
    const parsed = JobBody.safeParse(raw);
    if (parsed.success) return parsed.data;
    const field = parsed.error.issues[0]?.path.join(".") || "body";
    throw new ValidationError(`The field "${field}" of the job has the wrong type.`);
}
