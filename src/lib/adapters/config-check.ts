import { z } from "zod";
import { ValidationError } from "@/lib/logging/errors";
import { getAdapterDefinition } from "./definitions";
import { slotKeysOf } from "./credential-keys";
import { configFieldLabel } from "./field-label";
import { hasControlCharacter, isPortOrDefault } from "./command-values";

/**
 * The check of a connection config before it is stored, against the Zod schema of its adapter.
 * The form checks the same schema in the browser, but a request to the API can carry anything,
 * and the adapters take a stored config as it is: Zod defaults and coercion never run at run time.
 *
 * Only checked, never stored as parsed. The parse fills in defaults, coerces values and drops keys
 * the schema does not name, so storing its result would change configs nobody touched: a field
 * of an earlier version the adapter still reads, like the `uri` of MongoDB or a flag kept in the
 * config, would be gone, and a default that appears changes what the audit entry of the next edit
 * and the address check of `stored-secrets.ts` compare. So the config is stored as the request sent
 * it, merged with its stored secrets, once it fits.
 *
 * The keys a credential profile fills in are optional here, like in the form, since a profile may
 * supply the password, the key or the user, and a blank one counts as missing. A key the schema
 * does not name passes, an earlier version may have stored it.
 *
 * Beside the schema, `commandFieldProblems` checks the fields that reach command lines whatever the
 * schema of an adapter says: every port a whole number from 1 to 65535, every host and user text
 * without control characters. A copy of a connection and a restore from Recently deleted check only
 * these, since they store a config an earlier version saved, which the schema of today may refuse
 * for a field that never reaches a program. The adapters check what they put into a string a
 * program parses again before they run, see `command-values.ts`.
 */

type Config = Record<string, unknown>;

/** The fields that hold a port, of the connection or of its SSH server. */
const PORT_KEYS = ["port", "sshPort"] as const;

/** The fields that hold a host or a login name. */
const NAME_KEYS = ["host", "sshHost", "user", "username", "sshUsername"] as const;

const blank = (value: unknown) => value === undefined || value === null || (typeof value === "string" && value.trim() === "");

/**
 * The fields of a config whose value reaches a command line and cannot, as `label: problem`. Never
 * names a value.
 */
export function commandFieldProblems(config: Config): string[] {
    const problems: string[] = [];
    for (const key of PORT_KEYS) {
        if (!isPortOrDefault(config[key])) problems.push(`${configFieldLabel(key)}: must be a whole number from 1 to 65535`);
    }
    for (const key of NAME_KEYS) {
        const value = config[key];
        if (value === undefined || value === null) continue;
        if (typeof value !== "string") problems.push(`${configFieldLabel(key)}: must be text`);
        else if (hasControlCharacter(value)) problems.push(`${configFieldLabel(key)}: cannot hold a line break or another control character`);
    }
    return problems;
}

/**
 * The schema a stored config of the adapter has to fit, see the module: the schema of the adapter
 * with the keys its credential profiles fill in optional and blank counting as missing.
 */
function savedConfigSchema(adapterId: string): z.ZodObject | null {
    const definition = getAdapterDefinition(adapterId);
    if (!definition) return null;
    const { primary, ssh } = slotKeysOf(adapterId);
    const managed = new Set([...primary, ...ssh]);
    const shape: Record<string, z.ZodType> = { ...(definition.configSchema.shape as Record<string, z.ZodType>) };
    for (const key of managed) {
        if (!shape[key]) continue;
        shape[key] = z.preprocess((value) => (blank(value) ? undefined : value), shape[key].optional());
    }
    return z.object(shape);
}

/** The fields of a config that do not fit the schema of its adapter, as `label: message`. Empty when it fits. */
export function configSchemaProblems(adapterId: string, config: Config): string[] {
    const schema = savedConfigSchema(adapterId);
    if (!schema) return [`Unknown adapter ${adapterId}`];
    const result = schema.safeParse(config);
    if (result.success) return [];
    const byField = new Map<string, string>();
    for (const issue of result.error.issues) {
        const key = issue.path.length > 0 ? String(issue.path[0]) : "config";
        // Zod words its own messages without the value, and the messages of the schemas never name one.
        if (!byField.has(key)) byField.set(key, issue.message);
    }
    return [...byField].map(([key, message]) => `${configFieldLabel(key)}: ${message}`);
}

/** The sentence that refuses a config, with what is wrong with each field. */
function refusal(problems: string[]): string {
    return `The settings of the connection do not fit. ${problems.map((problem) => problem.replace(/\.$/, "")).join(". ")}.`;
}

/**
 * Refuses a config that does not fit the schema of its adapter, or whose fields that reach command
 * lines do not fit those, see the module. Takes the config the way it will be stored, its stored
 * secrets merged in.
 *
 * @throws ValidationError naming the fields and what is wrong with them, never their values.
 */
export function assertConfigFitsSchema(adapterId: string, config: Config): void {
    const problems = [...new Set([...configSchemaProblems(adapterId, config), ...commandFieldProblems(config)])];
    if (problems.length > 0) throw new ValidationError(refusal(problems), { field: "config" });
}

/**
 * Refuses a config whose fields that reach command lines do not fit, for a path that stores a config
 * an earlier version saved, like a copy or a restore from Recently deleted, see the module.
 *
 * @throws ValidationError naming the fields, never their values.
 */
export function assertCommandFields(config: Config): void {
    const problems = commandFieldProblems(config);
    if (problems.length > 0) throw new ValidationError(refusal(problems), { field: "config" });
}
