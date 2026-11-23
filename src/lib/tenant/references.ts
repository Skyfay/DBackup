import { ValidationError } from "@/lib/logging/errors";

/**
 * The tenant filter narrows queries, it does not look at the ids a write links to. A job of one
 * tenant that names the source of another by its id would back up a database of a stranger, so
 * every write that links records checks the ids first, with the client it writes with.
 */

const LABELS = {
    adapterConfig: "connection",
    credentialProfile: "saved login",
    encryptionProfile: "encryption key",
    retentionPolicy: "retention policy",
    namingTemplate: "naming template",
    schedulePreset: "schedule preset",
    excludePatternPreset: "exclude preset",
    notificationTemplate: "notification template",
    job: "job",
} as const;

export type ReferencedModel = keyof typeof LABELS;

/** The part of a client a check reads, the extended one or a transaction of it, which both filter by tenant. */
type CountingClient = Record<ReferencedModel, { count(args: { where: { id: { in: string[] } } }): Promise<number> }>;

/**
 * Throws a ValidationError unless every id names a row the code that runs now may see: one of its
 * own tenant, or any row in the system scope. A row of another tenant reads the same as one that
 * does not exist, so the answer gives nothing away.
 *
 * A value that is neither an id nor empty is refused outright. The types say none arrives, a request
 * body nobody checked says otherwise, and Prisma reads an object like `{ set: "<id>" }` on a foreign
 * key as the write it names. Leaving it out of the count would link the record this check refuses.
 */
export async function assertOwnRecords(client: unknown, references: Partial<Record<ReferencedModel, readonly (string | null | undefined)[]>>): Promise<void> {
    const counting = client as CountingClient;
    for (const [model, values] of Object.entries(references) as [ReferencedModel, readonly unknown[]][]) {
        if (!Array.isArray(values) || values.some((value) => value !== null && value !== undefined && typeof value !== "string")) {
            throw new ValidationError(`A linked ${LABELS[model]} is not named by its id.`);
        }
        const ids = [...new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0))];
        if (ids.length === 0) continue;
        const found = await counting[model].count({ where: { id: { in: ids } } });
        if (found !== ids.length) throw new ValidationError(`A linked ${LABELS[model]} does not exist.`);
    }
}
