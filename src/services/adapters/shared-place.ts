/**
 * A destination a tenant shares with customers keeps their backups under `tenants/<id>/` of its
 * folder, which the view of its own tenant hides, see `storage-view.ts`. A second connection of
 * that tenant to the same folder, one inside it or one that holds it would show them anyway, so a
 * storage connection of either role may not overlap such a destination, see `storage-place.ts`.
 */

import prisma from "@/lib/prisma";
import { decryptConfig } from "@/lib/crypto";
import { layLoginsOver } from "@/lib/adapters/config-resolver";
import { placesOverlap, storagePlaceOf } from "@/lib/adapters/storage-place";
import { STORAGE_ROLES } from "@/lib/core/storage-roles";
import { logger } from "@/lib/logging/logger";
import { ValidationError, wrapError } from "@/lib/logging/errors";

const log = logger.child({ service: "SharedPlace" });

type Config = Record<string, unknown>;

/** The logins a config is used with. */
export interface PlaceLogins {
    primaryCredentialId?: string | null;
    sshCredentialId?: string | null;
}

/** Why a connection may not keep its files where a shared destination keeps those of its customers. */
export function sharedPlaceRefusal(destination: string): string {
    return `It reaches the folder of ${destination}, a destination shared with customers whose backups lie there. Pick a place that neither lies inside its folder nor holds it.`;
}

/** A config with its logins laid over it, which name the account of an SSH or FTP server. The config alone when a login cannot be read. */
async function withLogins(adapterId: string, config: Config, logins: PlaceLogins): Promise<Config> {
    const primary = logins.primaryCredentialId ?? null;
    const ssh = logins.sshCredentialId ?? null;
    if (!primary && !ssh) return config;
    try {
        return await layLoginsOver(adapterId, { ...config }, primary, ssh);
    } catch (error: unknown) {
        log.warn("Failed to read a login for the place of a storage connection, its config alone counts", { adapterId }, wrapError(error));
        return config;
    }
}

/** The place of a stored storage connection, with its logins, null when it cannot be read or names none. */
async function placeOfRow(row: { id: string; adapterId: string; config: string } & PlaceLogins) {
    try {
        const plain = decryptConfig(JSON.parse(row.config)) as Config;
        return storagePlaceOf(row.adapterId, await withLogins(row.adapterId, plain, row));
    } catch (error: unknown) {
        log.warn("Failed to read a storage connection for its place", { configId: row.id }, wrapError(error));
        return null;
    }
}

const STORAGE_ROW = { id: true, name: true, adapterId: true, config: true, primaryCredentialId: true, sshCredentialId: true } as const;

/**
 * Refuses the first share of a destination while another storage connection of the tenant that
 * runs now reaches its folder, one made before the destination was shared or brought back from
 * Recently deleted, which `assertOffSharedPlaces` never saw.
 *
 * @throws ValidationError naming the other connection.
 */
export async function assertSharedPlaceAlone(destinationId: string): Promise<void> {
    const destination = await prisma.adapterConfig.findUnique({ where: { id: destinationId }, select: STORAGE_ROW });
    const place = destination ? await placeOfRow(destination) : null;
    if (!destination || !place) return;
    const others = await prisma.adapterConfig.findMany({ where: { type: "storage", id: { not: destinationId } }, select: STORAGE_ROW });
    for (const other of others) {
        const otherPlace = await placeOfRow(other);
        if (otherPlace && placesOverlap(place, otherPlace)) {
            throw new ValidationError(`${other.name} reaches the folder of ${destination.name}, where the backups of its customers would lie. Point it elsewhere or delete it before you share ${destination.name}.`);
        }
    }
}

/**
 * Refuses a storage connection whose files lie where a destination of the tenant that runs now,
 * shared with customers, keeps its own: the same folder, one inside it or one that holds it.
 * `exceptId` leaves out the connection that is being changed.
 *
 * @throws ValidationError naming the shared destination.
 */
export async function assertOffSharedPlaces(adapterId: string, config: Config, logins: PlaceLogins = {}, exceptId?: string): Promise<void> {
    const own = storagePlaceOf(adapterId, await withLogins(adapterId, config, logins));
    if (!own) return;
    // The shares of the tenant that runs now, the filter of its scope keeps those of others out. A
    // shared destination stays one, `updateAdapter` refuses its role change.
    const shares = await prisma.connectionShare.findMany({
        where: { config: { type: "storage", storageRole: STORAGE_ROLES.DESTINATION }, ...(exceptId ? { id: { not: exceptId } } : {}) },
        select: { config: { select: { id: true, name: true, adapterId: true, config: true, primaryCredentialId: true, sshCredentialId: true } } },
    });
    for (const { config: shared } of shares) {
        let plain: Config;
        try {
            plain = decryptConfig(JSON.parse(shared.config)) as Config;
        } catch (error: unknown) {
            log.warn("Failed to read a shared destination for the place of a storage connection", { configId: shared.id }, wrapError(error));
            continue;
        }
        const place = storagePlaceOf(shared.adapterId, await withLogins(shared.adapterId, plain, shared));
        if (place && placesOverlap(own, place)) throw new ValidationError(sharedPlaceRefusal(shared.name), { field: "config" });
    }
}
