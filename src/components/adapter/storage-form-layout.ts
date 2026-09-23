import type { AdapterDefinition } from "@/lib/adapters/definitions";
import { PREFIXED_SSH_KEYS } from "@/lib/adapters/ssh-key-convention";
import { transferConcurrencyRange } from "@/lib/adapters/transfer-concurrency";
import { STORAGE_ROLES, type StorageRole } from "@/lib/core/storage-roles";
import { credentialManagedKeys, loginRequired, requiredKeys } from "./connection-form-schema";
import { AUTHORIZED_KEY, LOGIN_KEY, NAME_KEY, SSH_LOGIN_KEY, type SectionLayout } from "./connection-form-layout";
import { STORAGE_ADVANCED_KEYS, STORAGE_CONFIG_KEYS, STORAGE_CONNECTION_KEYS, STORAGE_LOCATION_KEYS } from "./form-constants";

/** Keys another part of the form owns, or that nobody types in: the speed fields and the SSH login. */
const OWNED_ELSEWHERE = new Set([
    "connectionMode", "sshHost", "sshPort", ...PREFIXED_SSH_KEYS,
    "maxConcurrentFiles", "uploadConcurrency", "uploadPartSizeMb",
]);

/** A cloud drive, whose login is an OAuth app that still has to be let in. */
export function isOAuthAdapter(adapter: AdapterDefinition): boolean {
    return adapter.credentials?.primary === "OAUTH";
}

/** What goes into the speed part: whole files at once for a source, parts of one upload for a destination. */
export function speedKeys(adapter: AdapterDefinition, role: StorageRole): string[] {
    if (role === STORAGE_ROLES.SOURCE) return transferConcurrencyRange(adapter.id).max > 1 ? ["maxConcurrentFiles"] : [];
    return adapter.multipartUpload ? ["uploadConcurrency", "uploadPartSizeMb"] : [];
}

/** The keys of this adapter that the user types in, from a list and in its order. */
function fieldsOf(adapter: AdapterDefinition, keys: readonly string[]): string[] {
    const shape = adapter.configSchema.shape as Record<string, unknown>;
    const managed = credentialManagedKeys(adapter);
    return keys.filter((key) => key in shape && !managed.has(key));
}

/**
 * Where the storage is and how to reach it: the connection keys of `form-constants.ts`,
 * without the ones a login profile fills in.
 */
export function storageReachKeys(adapter: AdapterDefinition): string[] {
    return fieldsOf(adapter, STORAGE_CONNECTION_KEYS);
}

/**
 * The settings with a working default. Besides the lists, any key of the schema that no part
 * claims lands here, so a field added to an adapter is never left out of the form.
 */
function optionKeys(adapter: AdapterDefinition, role: StorageRole, claimed: Set<string>): string[] {
    const listed = fieldsOf(adapter, [...STORAGE_CONFIG_KEYS.filter((key) => !STORAGE_LOCATION_KEYS.includes(key)), ...STORAGE_ADVANCED_KEYS]);
    const unlisted = fieldsOf(adapter, Object.keys(adapter.configSchema.shape as Record<string, unknown>))
        .filter((key) => !claimed.has(key) && !listed.includes(key) && !OWNED_ELSEWHERE.has(key) && key !== "useVss");
    // A shadow copy is only ever read from, so only a directory source offers it.
    const snapshot = role === STORAGE_ROLES.SOURCE ? fieldsOf(adapter, ["useVss"]) : [];
    return [...listed, ...unlisted, ...snapshot];
}

/**
 * The parts of the form for a storage connection, for its role and the mode picked so far.
 *
 * The role changes what the form offers. Only a destination is checked for integrity and
 * uploads in parts, and only a source reads many files at once or from a shadow copy.
 */
export function storageLayout(adapter: AdapterDefinition, config: Record<string, unknown>, role: StorageRole): SectionLayout[] {
    const shape = adapter.configSchema.shape as Record<string, unknown>;
    const hasMode = "connectionMode" in shape;
    const mode = hasMode ? config.connectionMode : "direct";
    const reach = storageReachKeys(adapter);
    const login = adapter.credentials?.primary ? [LOGIN_KEY] : [];
    const expectedLogin = loginRequired(adapter) ? [LOGIN_KEY] : [];
    const oauth = isOAuthAdapter(adapter) ? [AUTHORIZED_KEY] : [];

    const connection: SectionLayout = {
        id: "connection",
        label: "Connection",
        keys: hasMode ? [NAME_KEY, "connectionMode"] : [NAME_KEY],
        expects: hasMode ? [NAME_KEY, "connectionMode"] : [NAME_KEY],
    };
    if (mode === "direct") {
        connection.description = oauth.length > 0
            ? `The app DBackup signs in to ${adapter.name} with, and your permission for it.`
            : "Where the storage is and how DBackup logs in.";
        connection.keys.push(...reach, ...login, ...oauth);
        connection.expects.push(...requiredKeys(adapter, reach), ...expectedLogin, ...oauth);
    } else {
        connection.description = "What to call it and how DBackup reaches it.";
    }

    const sections: SectionLayout[] = [connection];

    // Over SSH the storage is described as the SSH server sees it, like a database is.
    if (mode === "ssh") {
        const isDocker = adapter.id === "docker-volume";
        sections.push(
            {
                id: "ssh",
                label: "SSH server",
                description: isDocker ? "DBackup logs in here and reaches Docker through this machine." : "DBackup logs in here and reaches the storage through this machine.",
                keys: ["sshHost", "sshPort", SSH_LOGIN_KEY],
                expects: ["sshHost", SSH_LOGIN_KEY],
            },
            {
                id: "service",
                label: isDocker ? "Docker" : adapter.name,
                description: "As seen from the SSH server, not from DBackup.",
                keys: reach,
                expects: requiredKeys(adapter, reach),
            },
        );
    }

    const location = fieldsOf(adapter, STORAGE_LOCATION_KEYS);
    if (location.length > 0) {
        sections.push({
            id: "location",
            label: "Location",
            description: role === STORAGE_ROLES.SOURCE
                ? "The folder directory sources start from. Jobs pick their folders below it."
                : "The folder backups go to. Every job writes into a folder of its own below it.",
            keys: location,
            expects: requiredKeys(adapter, location),
        });
    }

    const options = optionKeys(adapter, role, new Set([...reach, ...location]));
    if (options.length > 0) {
        sections.push({ id: "options", label: "Options", description: "Only needed when the defaults do not fit.", keys: options, expects: [] });
    }

    const speed = speedKeys(adapter, role);
    if (speed.length > 0) {
        sections.push({ id: "speed", label: "Speed", description: "How much DBackup moves at once. The defaults suit most servers.", keys: speed, expects: [] });
    }

    sections.push({ id: "behavior", label: "Behavior", keys: [], expects: [] });
    return sections;
}
