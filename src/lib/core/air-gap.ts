import { STORAGE_ROLES } from "@/lib/core/storage-roles";

/**
 * An air-gapped destination is connected only now and then, like a USB disk plugged in once a
 * week or a NAS that is only on for its backups, whatever its adapter. While it is not connected
 * nothing about it is a problem: a run leaves it out, the health check reports nothing, and a
 * backup made meanwhile is not a copy missing there. The switch lives in the metadata of its
 * connection, beside the other switches of its form.
 */

export const AIR_GAPPED_KEY = "airGapped";

/** Why a run left a destination out, as the run records it for that destination. */
export const AIR_GAP_SKIP = "Air-gapped and not connected";

/** What the metadata of a connection says, from its stored JSON or already read. Broken metadata says nothing. */
function flagOf(metadata: string | Record<string, unknown> | null | undefined): boolean {
    if (!metadata) return false;
    if (typeof metadata !== "string") return metadata[AIR_GAPPED_KEY] === true;
    try {
        const parsed: unknown = JSON.parse(metadata);
        return typeof parsed === "object" && parsed !== null && (parsed as Record<string, unknown>)[AIR_GAPPED_KEY] === true;
    } catch {
        return false;
    }
}

/**
 * Whether a connection is an air-gapped destination. Only a backup destination can be one, a
 * directory source that kept the switch from an earlier role is not.
 */
export function isAirGapped(connection: { type?: string | null; storageRole?: string | null; metadata?: string | Record<string, unknown> | null }): boolean {
    if (connection.type !== undefined && connection.type !== null && connection.type !== "storage") return false;
    if (connection.storageRole !== undefined && connection.storageRole !== null && connection.storageRole !== STORAGE_ROLES.DESTINATION) return false;
    return flagOf(connection.metadata);
}

/** The status of the last health check, read for an air-gapped destination: anything but online is not connected. */
export function isNotConnected(connection: Parameters<typeof isAirGapped>[0] & { lastStatus?: string | null }): boolean {
    return isAirGapped(connection) && connection.lastStatus !== undefined && connection.lastStatus !== null && connection.lastStatus !== "ONLINE";
}
