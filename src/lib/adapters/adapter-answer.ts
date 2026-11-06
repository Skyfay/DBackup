import { AdapterError, DBackupError } from "@/lib/logging/errors";

/**
 * What the server or the adapter said when a picker read a saved connection, like a refused login
 * or a folder that is not there. A route whose purpose is that answer passes the message of an
 * `AdapterError` to whoever asked and answers anything else with a fixed sentence, since the words
 * of a failure of DBackup itself, like one of its database, are no answer of the server.
 */
export class AdapterAnswerError extends AdapterError {
    constructor(adapterId: string, operation: string, answer: string, cause?: Error) {
        super(adapterId, operation, answer, { cause });
        // The words of the server alone, without the adapter and operation the log keeps in its context.
        this.message = answer;
    }
}

/**
 * The failure of an adapter call as an `AdapterAnswerError`. An error of DBackup keeps its class, so
 * a refusal stays a refusal and an `AdapterError` stays as the adapter wrote it.
 */
export function asAdapterAnswer(adapterId: string, operation: string, error: unknown): unknown {
    if (error instanceof DBackupError) return error;
    if (error instanceof Error) return new AdapterAnswerError(adapterId, operation, error.message, error);
    return new AdapterAnswerError(adapterId, operation, String(error));
}

/** Runs one adapter call and turns its failure into `asAdapterAnswer`. */
export async function answerOf<T>(adapterId: string, operation: string, call: () => Promise<T>): Promise<T> {
    try {
        return await call();
    } catch (error: unknown) {
        throw asAdapterAnswer(adapterId, operation, error);
    }
}
