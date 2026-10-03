import { encrypt } from "@/lib/crypto";
import { counted, exists, idHere, listed, type ImportContext } from "./import-context";

/**
 * Groups, users with their sign-ins, and API keys. A group of the same name or a user of the same
 * email here takes the one of the file and keeps its id.
 */
export async function importUsers({ tx, data, ids, known, notes }: ImportContext): Promise<void> {
    for (const group of data.groups) {
        const existingByName = await tx.group.findUnique({ where: { name: group.name } });
        if (existingByName && existingByName.id !== group.id) {
            await tx.group.update({ where: { id: existingByName.id }, data: { permissions: group.permissions, updatedAt: group.updatedAt } });
            ids.groups.set(group.id, existingByName.id);
        } else {
            await tx.group.upsert({ where: { id: group.id }, create: group, update: group });
        }
    }

    const withoutSecondFactor: string[] = [];
    for (const user of data.users) {
        const { accounts, ...userFields } = user;
        if (userFields.groupId) userFields.groupId = idHere(ids.groups, userFields.groupId);

        const existingUser = await tx.user.findUnique({ where: { email: user.email } });
        if (existingUser && existingUser.id !== user.id) {
            const { id: _id, email: _email, ...updateFields } = userFields;
            await tx.user.update({ where: { id: existingUser.id }, data: updateFields });
            ids.users.set(user.id, existingUser.id);
        } else {
            await tx.user.upsert({ where: { id: user.id }, create: userFields, update: userFields });
        }

        const userId = idHere(ids.users, user.id);
        known.users.add(userId);

        for (const account of Array.isArray(accounts) ? accounts : []) {
            const remappedAccount = { ...account, userId };
            await tx.account.upsert({ where: { id: account.id }, create: remappedAccount, update: remappedAccount });
        }

        // The file holds no second factor. A user it would still ask for one could never sign in,
        // so the second factor is off until they set it up again.
        const lost = {
            twoFactorEnabled: !!userFields.twoFactorEnabled && !(await tx.twoFactor.findUnique({ where: { userId }, select: { id: true } })),
            passkeyTwoFactor: !!userFields.passkeyTwoFactor && (await tx.passkey.count({ where: { userId } })) === 0,
        };
        if (lost.twoFactorEnabled || lost.passkeyTwoFactor) {
            await tx.user.update({
                where: { id: userId },
                data: { ...(lost.twoFactorEnabled ? { twoFactorEnabled: false } : {}), ...(lost.passkeyTwoFactor ? { passkeyTwoFactor: false } : {}) },
            });
            withoutSecondFactor.push(user.email);
        }
    }

    let keysLeftOut = 0;
    for (const key of data.apiKeys ?? []) {
        // A file without the logins holds the key without its hash.
        if (!key.hashedKey) continue;
        const remappedKey = { ...key, userId: idHere(ids.users, key.userId) };
        if (!(await exists(known.users, remappedKey.userId, () => tx.user.findUnique({ where: { id: remappedKey.userId }, select: { id: true } })))) {
            keysLeftOut++;
            continue;
        }
        await tx.apiKey.upsert({ where: { id: remappedKey.id }, create: remappedKey, update: remappedKey });
    }

    if (withoutSecondFactor.length > 0) {
        notes.push(`${counted(withoutSecondFactor.length, "user signs", "users sign")} in without a second factor until they set it up again, since the file holds none: ${listed(withoutSecondFactor)}.`);
    }
    if (keysLeftOut > 0) notes.push(`${counted(keysLeftOut, "API key was", "API keys were")} left out, since the user it belongs to is not here.`);
}

/** Sign-in providers, their secrets encrypted again with the key of this DBackup. */
export async function importSsoProviders({ tx, data, ids }: ImportContext): Promise<void> {
    for (const provider of data.ssoProviders) {
        const providerData = { ...provider };
        if (providerData.clientId) {
            try { providerData.clientId = encrypt(providerData.clientId); } catch { /* already encrypted or empty */ }
        }
        if (providerData.clientSecret) {
            try { providerData.clientSecret = encrypt(providerData.clientSecret); } catch { /* already encrypted or empty */ }
        }
        if (providerData.oidcConfig) {
            try {
                const oidcConfig = JSON.parse(providerData.oidcConfig);
                if (oidcConfig.clientId) oidcConfig.clientId = encrypt(oidcConfig.clientId);
                if (oidcConfig.clientSecret) oidcConfig.clientSecret = encrypt(oidcConfig.clientSecret);
                providerData.oidcConfig = JSON.stringify(oidcConfig);
            } catch { /* parse error, keep as-is */ }
        }

        // The group new people start in may have merged into a group of the same name.
        if (providerData.defaultGroupId) providerData.defaultGroupId = idHere(ids.groups, providerData.defaultGroupId);

        const existingSso = await tx.ssoProvider.findUnique({ where: { providerId: providerData.providerId } });
        if (existingSso && existingSso.id !== providerData.id) {
            const { id: _id, ...ssoUpdateFields } = providerData;
            await tx.ssoProvider.update({ where: { id: existingSso.id }, data: ssoUpdateFields });
        } else {
            await tx.ssoProvider.upsert({ where: { id: providerData.id }, create: providerData, update: providerData });
        }
    }
}
