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
    return role === STORAGE_ROLES.SOURCE ? "Directory source" : "Destination";
}

/**
 * Whether an adapter declaring `supportedRoles` may serve this role. Omitted means both.
 *
 * Lives here rather than beside the API check because the same question is asked in two
 * places that cannot import each other: the boundary that refuses a bad config, and the
 * picker that should never have offered it. Two copies of `!allowed || allowed.includes(...)`
 * is exactly how one of them ends up out of step with the other.
 */
export function supportsStorageRole(
    supportedRoles: readonly StorageRole[] | undefined,
    role: StorageRole
): boolean {
    return !supportedRoles || supportedRoles.includes(role);
}

/** The other role. A config is one or the other, so there is exactly one. */
export function counterpartStorageRole(role: StorageRole): StorageRole {
    return role === STORAGE_ROLES.SOURCE ? STORAGE_ROLES.DESTINATION : STORAGE_ROLES.SOURCE;
}

/**
 * Whether "create this again in the opposite role" is an offer worth making.
 *
 * The same server is often wanted as both a destination and a source, which is what that
 * action is for. An adapter that only works one way round has no counterpart, and the API
 * refuses the clone - so offering it could only ever produce a rejected save.
 */
export function canOfferCounterpart(
    supportedRoles: readonly StorageRole[] | undefined,
    currentRole: StorageRole
): boolean {
    return supportsStorageRole(supportedRoles, counterpartStorageRole(currentRole));
}
