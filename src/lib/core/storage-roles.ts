/**
 * The role a storage adapter config serves.
 *
 * Exclusive by design. A destination owns the root configured on the adapter: the runner
 * writes `<root>/<jobName>/…`, and incremental jobs additionally create `chain-<ts>/`
 * folders there ([03-upload.ts](src/lib/runner/steps/03-upload.ts)). A directory source
 * reads the folders picked for it out of that same root, up to and including the root
 * itself ("Back up everything"). One config serving both would mean a job collecting its
 * own previous archives on every run.
 *
 * Only meaningful for `type === "storage"`. Database and notification configs carry the
 * default and never consult it.
 */
export const STORAGE_ROLES = {
    DESTINATION: "DESTINATION",
    SOURCE: "SOURCE",
} as const;

export type StorageRole = typeof STORAGE_ROLES[keyof typeof STORAGE_ROLES];

export const STORAGE_ROLE_VALUES: readonly StorageRole[] = [
    STORAGE_ROLES.DESTINATION,
    STORAGE_ROLES.SOURCE,
];

export function isStorageRole(value: unknown): value is StorageRole {
    return typeof value === "string" && (STORAGE_ROLE_VALUES as readonly string[]).includes(value);
}

/** Human-readable label for the role, used in list badges and form options. */
export function storageRoleLabel(role: StorageRole): string {
    return role === STORAGE_ROLES.SOURCE ? "Directory Source" : "Backup Destination";
}
