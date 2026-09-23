import type { AdapterDefinition } from "@/lib/adapters/definitions";
import { STORAGE_ROLES, supportsStorageRole, type StorageRole } from "@/lib/core/storage-roles";
import { credentialManagedKeys } from "./connection-form-schema";
import { seedSchemaDefaults } from "./schema-defaults";
import type { AdapterConfig } from "./types";

/** A JSON object stored as text, or an empty one when there is none or it cannot be read. */
export function parseObject(json: string | null | undefined): Record<string, unknown> {
    if (!json) return {};
    try {
        const value: unknown = JSON.parse(json);
        return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
    } catch {
        return {};
    }
}

type SchemaNode = { _def?: { type?: string; innerType?: unknown }; safeParse: (value: unknown) => { success: boolean; data?: unknown } };

/** The type under any default or optional wrapper, like "string" or "array". */
function baseType(node: SchemaNode): string | undefined {
    let current: SchemaNode | undefined = node;
    while (current?._def) {
        if (!current._def.innerType) return current._def.type;
        current = current._def.innerType as SchemaNode;
    }
    return undefined;
}

/**
 * Required text starts as an empty string rather than missing, so Zod reports the adapter's
 * own message, like "Bucket name is required", instead of "expected string, received
 * undefined". Fields a credential profile fills in are left alone.
 */
export function fillRequiredText(adapter: AdapterDefinition, config: Record<string, unknown>): Record<string, unknown> {
    const managed = credentialManagedKeys(adapter);
    for (const [key, node] of Object.entries(adapter.configSchema.shape as Record<string, SchemaNode>)) {
        if (config[key] !== undefined || managed.has(key)) continue;
        if (baseType(node) === "string" && !node.safeParse(undefined).success) config[key] = "";
    }
    return config;
}

/**
 * A new connection starts with the defaults its schema declares, like the port, and with
 * an empty list where the schema wants one. Without it a required list such as the Firebird
 * aliases reports a missing value in Zod's words instead of its own message.
 */
export function defaultConfig(adapter: AdapterDefinition): Record<string, unknown> {
    const config: Record<string, unknown> = {};
    const key = (name: string) => name.slice("config.".length);
    seedSchemaDefaults(adapter.configSchema, {
        getValues: (name) => config[key(name)],
        setValue: (name, value) => {
            config[key(name)] = value;
        },
    });
    const shape = adapter.configSchema.shape as Record<string, SchemaNode>;
    for (const [name, node] of Object.entries(shape)) {
        if (config[name] === undefined && baseType(node) === "array") config[name] = [];
    }
    // `mode` only picks the layout for SQLite. For Redis it is an ordinary setting, standalone
    // or Sentinel, and the seeding above skips it by name.
    if (adapter.id !== "sqlite" && "mode" in shape && config.mode === undefined) {
        const parsed = shape.mode.safeParse(undefined);
        if (parsed.success && parsed.data !== undefined) config.mode = parsed.data;
    }
    return config;
}

/**
 * The role a storage connection holds: its stored one, else the page's, else a destination.
 * An adapter that only works one way round overrides it, since the API refuses the other.
 */
export function initialRole(adapter: AdapterDefinition, initialData: AdapterConfig | undefined, defaultRole: StorageRole | undefined): StorageRole {
    const wanted = initialData?.storageRole ?? defaultRole ?? STORAGE_ROLES.DESTINATION;
    return supportsStorageRole(adapter.supportedRoles, wanted) ? wanted : (adapter.supportedRoles?.[0] ?? wanted);
}
