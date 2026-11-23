import { z } from "zod";
import type { AdapterDefinition } from "@/lib/adapters/definitions";
import { managedConfigKeys, PRIMARY_CREDENTIAL_KEYS } from "@/lib/adapters/credential-keys";

/** What the connection form holds. The config is whatever the adapter's schema describes. */
export interface ConnectionFormValues {
    name: string;
    adapterId: string;
    config: Record<string, unknown>;
}

type Shape = Record<string, z.ZodType>;

function shapeOf(adapter: AdapterDefinition): Shape {
    return adapter.configSchema.shape as Shape;
}

/**
 * The config keys an assigned credential profile owns. The form hides them, and they are
 * optional in its schema, since a hidden required field would fail without saying so.
 */
export function credentialManagedKeys(adapter: AdapterDefinition): Set<string> {
    return managedConfigKeys(adapter.credentials, adapter.configSchema);
}

/**
 * Whether the adapter cannot log in without its primary profile. True when one of the keys
 * the profile fills is required by the adapter's own schema, like a MySQL user.
 */
export function loginRequired(adapter: AdapterDefinition): boolean {
    const primary = adapter.credentials?.primary;
    if (!primary) return false;
    const shape = shapeOf(adapter);
    return PRIMARY_CREDENTIAL_KEYS[primary].some((key) => key in shape && !shape[key].safeParse(undefined).success);
}

/**
 * The keys among these that the user has to fill in: required by the adapter's schema, with
 * no default, and not left to a credential profile.
 */
export function requiredKeys(adapter: AdapterDefinition, keys: string[]): string[] {
    const shape = shapeOf(adapter);
    const managed = credentialManagedKeys(adapter);
    return keys.filter((key) => key in shape && !managed.has(key) && !shape[key].safeParse(undefined).success);
}

/**
 * The schema the form validates against: the adapter's config, minus what a profile fills in.
 *
 * The connection mode loses its default here. The form shows nothing below it until one is
 * picked, since the two modes ask for different things, and a default would let Create
 * through on a mode nobody chose.
 */
export function buildConnectionFormSchema(adapter: AdapterDefinition) {
    const shape: Shape = { ...shapeOf(adapter) };

    for (const key of credentialManagedKeys(adapter)) {
        if (shape[key]) shape[key] = shape[key].optional();
    }
    if ("connectionMode" in shape) {
        shape.connectionMode = z.enum(["direct", "ssh"], { error: "Choose how DBackup connects." });
    }
    if (adapter.id === "sqlite") {
        shape.mode = z.enum(["local", "ssh"], { error: "Choose where the database file is." });
    }
    if (adapter.id === "email" && "to" in shape) {
        // The form edits recipients as a list, also where an older config stored one address.
        // Zod would name a failed union only "Invalid input", so the list says what is wrong.
        shape.to = z.preprocess(
            (value) => (typeof value === "string" ? (value ? [value] : []) : (value ?? [])),
            z.array(z.string().email("Enter a valid email address.")).min(1, "Add at least one recipient."),
        );
    }

    return z.object({
        name: z.string().min(1, "Name is required"),
        adapterId: z.string().min(1, "Type is required"),
        config: z.object(shape),
    });
}
