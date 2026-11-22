import { ValidationError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { heldAtSealedTime, type OwnerFacts, type SharedCopy } from "./shared-backups";
import { copyProofProblem, type OpenedCopy } from "./shared-copy-proof";

const log = logger.child({ service: "SharedCopyRead" });

/** Whose read of a copy it is: the customer, the database and the facts of the server that judge its time. */
export interface CopyReader {
    tenantId: string;
    databaseName: string;
    facts: OwnerFacts;
}

/**
 * Refuses a copy whose opened archive is not the backup its proof stands for, before anything of it
 * is handed out or restored, see `shared-copy-proof.ts`. The download and the restore of a customer
 * try the next copy then. The reason stays in the log, since it names what the server has.
 */
export function assertCopyProven(copy: SharedCopy, archive: OpenedCopy, reader: CopyReader): void {
    const problem = copyProofProblem(copy.proof, archive, (sealedAt) => heldAtSealedTime(reader.facts, reader.tenantId, reader.databaseName, sealedAt));
    if (!problem) return;
    log.warn("Refusing a copy of a shared backup without its proof", { destinationId: copy.destinationId, proof: copy.proof.kind, problem });
    throw new ValidationError("This backup cannot be read right now, so it cannot be restored.");
}
