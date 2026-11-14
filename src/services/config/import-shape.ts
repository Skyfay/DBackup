import { ValidationError } from "@/lib/logging/errors";
import type { AppConfigurationBackup } from "@/lib/types/config-backup";

/**
 * The records of a file go to the database as they are, so a record may hold columns alone. A value
 * that is an object would reach Prisma as a nested write, which creates, changes and deletes rows of
 * other tables of the file's choosing, like the accounts a restore just made. No file DBackup wrote
 * holds one: every column is text, a number, a switch or a date, and the sign-ins of a user are the
 * one list inside a record, read on its own.
 */

/** A restore that leaves no account, which would keep the first sign-up open in a database someone else wrote. */
export const LEAVES_NO_ACCOUNT = "The backup holds no account, so DBackup would be left without one to sign in with. Restore a backup that holds the accounts.";

export const NOT_A_BACKUP = "The file is no configuration backup of DBackup.";

/** The parts of a file that are lists of records. */
const PARTS = ["settings", "credentialProfiles", "adapters", "jobs", "jobDestinations", "apiKeys", "users", "groups", "ssoProviders", "encryptionProfiles"];

/** The lists inside a record that the import reads itself, by the part of the file. */
const OWN_LISTS: Record<string, string> = { users: "accounts" };

const isColumnValue = (value: unknown): boolean => value === null || value === undefined || typeof value !== "object" || value instanceof Date;

function assertColumnsOnly(record: unknown, ownList?: string): void {
    if (record === null || typeof record !== "object" || Array.isArray(record)) throw new ValidationError(NOT_A_BACKUP);
    for (const [column, value] of Object.entries(record)) {
        if (column === ownList && Array.isArray(value)) {
            for (const entry of value) assertColumnsOnly(entry);
            continue;
        }
        if (!isColumnValue(value)) throw new ValidationError(NOT_A_BACKUP);
    }
}

function assertPart(name: string, records: unknown): void {
    if (records === undefined || records === null) return;
    if (!Array.isArray(records)) throw new ValidationError(NOT_A_BACKUP);
    for (const record of records) assertColumnsOnly(record, OWN_LISTS[name]);
}

/**
 * Refuses a file with a record that holds anything but columns.
 *
 * @throws ValidationError with `NOT_A_BACKUP`.
 */
export function assertFlatRecords(data: AppConfigurationBackup): void {
    const parts = data as unknown as Record<string, unknown>;
    for (const name of PARTS) assertPart(name, parts[name]);
    const statistics = parts.statistics;
    if (statistics === undefined || statistics === null) return;
    if (typeof statistics !== "object" || Array.isArray(statistics)) throw new ValidationError(NOT_A_BACKUP);
    for (const [name, records] of Object.entries(statistics)) assertPart(name, records);
}
