import { encryptConfig, encrypt } from "@/lib/crypto";
import { logger } from "@/lib/logging/logger";
import { exists, type ImportContext } from "./import-context";

const svcLog = logger.child({ service: "ConfigService" });

/** The settings of the file, key by key. */
export async function importSettings({ tx, data }: ImportContext): Promise<void> {
    for (const setting of data.settings) {
        await tx.systemSetting.upsert({
            where: { key: setting.key },
            create: setting,
            update: setting,
        });
    }
}

/** Saved logins, before the connections that sign in with them. A login of the same name here takes the one of the file. */
export async function importCredentialProfiles({ tx, data, ids }: ImportContext): Promise<void> {
    for (const profile of data.credentialProfiles ?? []) {
        // A file without the logins holds the profile without its data.
        if (!profile.data) {
            svcLog.warn("Skipping credential profile - secret data missing in export", { profileId: profile.id, name: profile.name });
            continue;
        }

        // Encrypted again with the key of this DBackup.
        const profileData = { ...profile, data: encrypt(profile.data) };

        const existingByName = await tx.credentialProfile.findUnique({ where: { name: profile.name } });
        if (existingByName && existingByName.id !== profile.id) {
            const { id: _id, ...updateFields } = profileData;
            await tx.credentialProfile.update({ where: { id: existingByName.id }, data: updateFields });
            ids.credentials.set(profile.id, existingByName.id);
        } else {
            await tx.credentialProfile.upsert({ where: { id: profile.id }, create: profileData, update: profileData });
        }
    }
}

/** Connections. One of the same name and type here takes the one of the file and keeps its id. */
export async function importAdapters({ tx, data, ids, known }: ImportContext): Promise<void> {
    for (const adapter of data.adapters) {
        let configObj: Record<string, unknown> = {};
        try {
            configObj = JSON.parse(adapter.config);
        } catch { /* empty */ }

        // Encrypted again with the key of this DBackup.
        const adapterData = { ...adapter, config: JSON.stringify(encryptConfig(configObj)) };

        if (adapterData.primaryCredentialId) adapterData.primaryCredentialId = ids.credentials.get(adapterData.primaryCredentialId) ?? adapterData.primaryCredentialId;
        if (adapterData.sshCredentialId) adapterData.sshCredentialId = ids.credentials.get(adapterData.sshCredentialId) ?? adapterData.sshCredentialId;

        // A login that is not here would break the link, so the connection comes back without it.
        if (adapterData.primaryCredentialId) {
            const credExists = await tx.credentialProfile.findUnique({ where: { id: adapterData.primaryCredentialId }, select: { id: true } });
            if (!credExists) {
                svcLog.warn("Removing invalid primaryCredentialId from adapter", { adapterId: adapter.id, primaryCredentialId: adapterData.primaryCredentialId });
                adapterData.primaryCredentialId = null;
            }
        }
        if (adapterData.sshCredentialId) {
            const credExists = await tx.credentialProfile.findUnique({ where: { id: adapterData.sshCredentialId }, select: { id: true } });
            if (!credExists) {
                svcLog.warn("Removing invalid sshCredentialId from adapter", { adapterId: adapter.id, sshCredentialId: adapterData.sshCredentialId });
                adapterData.sshCredentialId = null;
            }
        }
        // The retention policy a destination suggests for new jobs. The file holds no templates.
        if (adapterData.defaultRetentionPolicyId) {
            const policy = await tx.retentionPolicy.findUnique({ where: { id: adapterData.defaultRetentionPolicyId }, select: { id: true } });
            if (!policy) adapterData.defaultRetentionPolicyId = null;
        }

        const existingByName = await tx.adapterConfig.findFirst({ where: { name: adapter.name, type: adapter.type } });
        if (existingByName && existingByName.id !== adapter.id) {
            const { id: _id, ...updateFields } = adapterData;
            await tx.adapterConfig.update({ where: { id: existingByName.id }, data: updateFields });
            ids.adapters.set(adapter.id, existingByName.id);
            known.adapters.add(existingByName.id);
        } else {
            await tx.adapterConfig.upsert({ where: { id: adapter.id }, create: adapterData, update: adapterData });
            known.adapters.add(adapter.id);
        }
    }
}

/**
 * Encryption keys. A key of the same name here keeps its secret and takes the name and description
 * of the file. A key that is not here comes back only when the file holds its secret.
 */
export async function importEncryptionProfiles({ tx, data, ids, known }: ImportContext): Promise<void> {
    for (const profile of data.encryptionProfiles) {
        const existingByName = await tx.encryptionProfile.findFirst({ where: { name: profile.name } });
        const described = { name: profile.name, description: profile.description, updatedAt: new Date() };

        if (existingByName && existingByName.id !== profile.id) {
            await tx.encryptionProfile.update({ where: { id: existingByName.id }, data: described });
            ids.profiles.set(profile.id, existingByName.id);
            known.profiles.add(existingByName.id);
            continue;
        }

        if (await exists(known.profiles, profile.id, () => tx.encryptionProfile.findUnique({ where: { id: profile.id } }))) {
            await tx.encryptionProfile.update({ where: { id: profile.id }, data: described });
            continue;
        }

        // The export leaves the secret out of the file without the logins.
        const secretKey = (profile as { secretKey?: string }).secretKey;
        if (!secretKey) {
            svcLog.warn("Skipping encryption profile - secret key missing in export", { profileId: profile.id, name: profile.name });
            continue;
        }
        await tx.encryptionProfile.create({ data: { ...profile, secretKey: encrypt(secretKey) } });
        known.profiles.add(profile.id);
    }
}
