import prisma from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";
import { STORAGE_ROLES } from "@/lib/core/storage-roles";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { storageService, type RichFileInfo } from "@/services/storage/storage-service";
import { getDataRetentionValues } from "@/services/system/data-retention-service";
import { aliasesOf } from "./key-aliases";
import { keyIdOf } from "./key-id";
import { keyAudit, type KeyAudit, type KitEntry } from "./vault-audit";
import { isKeyInUse, type VaultKey, type VaultKeyBackup, type VaultKeyDestination, type VaultKeyJob, type VaultKeysModel, type VaultKit } from "./vault-types";

const log = logger.child({ service: "VaultKeys" });

/** The setting that names the key of the config backup. */
export const CONFIG_BACKUP_KEY_SETTING = "config.backup.profileId";

/** How many of the newest backups of a key the model names. */
const RECENT_BACKUPS = 5;

/** A kit in the audit log belongs to the time stored on the key when it was written this close to it. */
const SAME_KIT_MS = 5 * 60_000;

/** A key as it is read for the model, with the key itself already turned into its Key ID. */
export interface KeyRecord {
    id: string;
    name: string;
    description: string | null;
    createdAt: Date;
    updatedAt: Date;
    keyId: string | null;
    kitDownloadedAt: Date | null;
    /** Other profile ids whose backups the key opens, see `rememberKeyFor`. */
    aliases: string[];
    jobs: VaultKeyJob[];
    configBackup: boolean;
}

type ListedFile = Pick<RichFileInfo, "name" | "path" | "size" | "lastModified" | "createdAt" | "jobName" | "isEncrypted" | "encryptionProfileId">;

/** A destination with the backups of its cached listing. */
export interface ListedDestination {
    id: string;
    name: string;
    adapterId: string;
    files: ListedFile[];
}

const timeOf = (file: ListedFile) => Date.parse(file.createdAt ?? String(file.lastModified)) || 0;

/** The kit a key was last in: the time stored on the key, with who and how many keys from the audit log. */
function kitOf(key: KeyRecord, kits: KitEntry[]): VaultKit | null {
    const entry = kits.find((kit) => kit.profileIds.includes(key.id));
    if (!key.kitDownloadedAt) return entry ? { at: entry.at, by: entry.by, keys: entry.profileIds.length } : null;
    const at = key.kitDownloadedAt.toISOString();
    const same = entry && Math.abs(Date.parse(entry.at) - key.kitDownloadedAt.getTime()) <= SAME_KIT_MS;
    return { at, by: same ? entry.by : null, keys: same ? entry.profileIds.length : null };
}

function addTo(counts: Map<string, VaultKeyDestination>, destination: ListedDestination) {
    const current = counts.get(destination.id);
    if (current) current.count += 1;
    else counts.set(destination.id, { id: destination.id, name: destination.name, adapterId: destination.adapterId, count: 1 });
}

const byCount = (a: VaultKeyDestination, b: VaultKeyDestination) => b.count - a.count || a.name.localeCompare(b.name);

/** The Encryption tab: every key with what encrypts with it, what it protects and its recovery kit. */
export function buildKeysModel(records: KeyRecord[], destinations: ListedDestination[], audit: KeyAudit, auditDays: number): VaultKeysModel {
    // A backup counts under the key it names, or under the key that opened it for a profile that is gone.
    const owners = new Map<string, string>();
    for (const record of records) for (const alias of record.aliases) owners.set(alias, record.id);
    for (const record of records) owners.set(record.id, record.id);
    const perKey = new Map<string, Map<string, VaultKeyDestination>>();
    const newest = new Map<string, { file: ListedFile; destination: ListedDestination }[]>();
    const missing = new Map<string, VaultKeyDestination>();
    const missingKeys = new Set<string>();
    let backups = 0;
    let encrypted = 0;

    for (const destination of destinations) {
        for (const file of destination.files) {
            backups += 1;
            if (!file.isEncrypted) continue;
            encrypted += 1;
            const named = file.encryptionProfileId;
            if (!named) continue;
            const profileId = owners.get(named);
            if (!profileId) {
                addTo(missing, destination);
                missingKeys.add(named);
                continue;
            }
            const counts = perKey.get(profileId) ?? new Map<string, VaultKeyDestination>();
            addTo(counts, destination);
            perKey.set(profileId, counts);
            const list = newest.get(profileId) ?? [];
            list.push({ file, destination });
            newest.set(profileId, list);
        }
    }

    const keys: VaultKey[] = records.map((record) => {
        const counts = [...(perKey.get(record.id)?.values() ?? [])].sort(byCount);
        const recent: VaultKeyBackup[] = (newest.get(record.id) ?? [])
            .sort((a, b) => timeOf(b.file) - timeOf(a.file))
            .slice(0, RECENT_BACKUPS)
            .map(({ file, destination }) => ({
                name: file.name,
                path: file.path,
                destinationId: destination.id,
                destinationName: destination.name,
                adapterId: destination.adapterId,
                size: file.size ?? 0,
                createdAt: file.createdAt ?? (file.lastModified ? new Date(file.lastModified).toISOString() : null),
                jobName: file.jobName ?? null,
            }));
        const reveal = audit.reveals.get(record.id);
        return {
            id: record.id,
            name: record.name,
            description: record.description,
            createdAt: record.createdAt.toISOString(),
            updatedAt: record.updatedAt.toISOString(),
            keyId: record.keyId,
            jobs: record.jobs,
            configBackup: record.configBackup,
            backups: counts.reduce((sum, destination) => sum + destination.count, 0),
            destinations: counts,
            recent,
            kit: kitOf(record, audit.kits),
            created: audit.created.get(record.id) ?? null,
            revealed: reveal?.last ?? null,
        };
    });

    const lastKit = keys
        .map((key) => key.kit)
        .filter((kit): kit is VaultKit => kit !== null)
        .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0] ?? null;
    const missingDestinations = [...missing.values()].sort(byCount);

    return {
        keys,
        stats: {
            keys: keys.length,
            jobs: keys.reduce((sum, key) => sum + key.jobs.length, 0),
            keysInUse: keys.filter(isKeyInUse).length,
            backups,
            encrypted,
            missing: {
                count: missingDestinations.reduce((sum, destination) => sum + destination.count, 0),
                keys: missingKeys.size,
                destinations: missingDestinations,
            },
            neverInKit: keys.filter((key) => !key.kit).map((key) => key.name),
            lastKit,
        },
        auditDays,
    };
}

/** The Key ID of a stored key, or null when the key of this install cannot open it. */
function readKeyId(id: string, secretKey: string): string | null {
    try {
        return keyIdOf(decrypt(secretKey));
    } catch (error) {
        log.warn("An encryption key could not be read for its Key ID", { profileId: id }, wrapError(error));
        return null;
    }
}

/** Every backup destination with the backups its cached listing holds. A page never waits for a storage. */
async function listedDestinations(): Promise<ListedDestination[]> {
    const configs = await prisma.adapterConfig.findMany({
        where: { type: "storage", storageRole: STORAGE_ROLES.DESTINATION },
        select: { id: true, name: true, adapterId: true },
        orderBy: { name: "asc" },
    });
    return Promise.all(
        configs.map(async (config) => {
            const cached = await storageService.readCachedListing(config.id).catch((error: unknown) => {
                log.warn("Could not read the cached listing", { destinationId: config.id }, wrapError(error));
                return null;
            });
            return { ...config, files: cached?.files ?? [] };
        })
    );
}

/** Loads the Encryption tab of the Vault page. */
export async function getVaultKeys(): Promise<VaultKeysModel> {
    const [profiles, configKey, destinations, retention] = await Promise.all([
        prisma.encryptionProfile.findMany({
            orderBy: { createdAt: "desc" },
            select: {
                id: true,
                name: true,
                description: true,
                secretKey: true,
                kitDownloadedAt: true,
                aliases: true,
                createdAt: true,
                updatedAt: true,
                jobs: {
                    orderBy: { name: "asc" },
                    select: {
                        id: true,
                        name: true,
                        enabled: true,
                        schedule: true,
                        schedulePreset: { select: { schedule: true } },
                        source: { select: { adapterId: true } },
                        _count: { select: { sources: true } },
                    },
                },
            },
        }),
        prisma.systemSetting.findUnique({ where: { key: CONFIG_BACKUP_KEY_SETTING }, select: { value: true } }),
        listedDestinations(),
        getDataRetentionValues(),
    ]);

    const records: KeyRecord[] = profiles.map((profile) => ({
        id: profile.id,
        name: profile.name,
        description: profile.description,
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
        keyId: readKeyId(profile.id, profile.secretKey),
        kitDownloadedAt: profile.kitDownloadedAt,
        aliases: aliasesOf(profile.aliases),
        configBackup: configKey?.value === profile.id,
        jobs: profile.jobs.map((job) => ({
            id: job.id,
            name: job.name,
            enabled: job.enabled,
            schedule: job.schedulePreset?.schedule ?? job.schedule,
            sourceType: job.source?.adapterId ?? null,
            hasFolders: job._count.sources > 0,
        })),
    }));

    const audit = await keyAudit(records.map((record) => record.id));
    return buildKeysModel(records, destinations, audit, retention.auditLog);
}
