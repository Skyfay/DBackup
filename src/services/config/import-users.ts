import { encrypt } from "@/lib/crypto";
import { PLATFORM_ADMIN_ROLE } from "@/lib/auth/owner-permissions";
import { HOME_TENANT_ID } from "@/lib/tenant/home";
import type { Tx } from "@/lib/prisma-tx";
import { ensureFullAccessGroup } from "@/services/user/group-service";
import { counted, exists, idHere, listed, type ImportContext } from "./import-context";

/** A name no group has yet, the wanted one or with a number after it. */
async function freeGroupName(tx: Tx, wanted: string): Promise<string> {
    for (let n = 1; ; n++) {
        const name = n === 1 ? wanted : `${wanted} ${n}`;
        if (!(await tx.group.findFirst({ where: { name }, select: { id: true } }))) return name;
    }
}

/** The group of the files of earlier versions that passed every check. */
const LEGACY_SUPER_ADMIN = "SuperAdmin";

/** The rights a group of a file had on the settings, which split into the settings and the tenant settings since. */
const TENANT_SETTINGS_OF: Record<string, string> = { "settings:read": "tenant-settings:read", "settings:write": "tenant-settings:write" };

/**
 * The permissions of a group of a file from before the tenants, with the rights on the tenant
 * settings and Recently deleted that a group of the same rights got with the update.
 */
export function withTenantSettings(permissions: string): string {
    let list: unknown;
    try {
        list = JSON.parse(permissions);
    } catch {
        return permissions;
    }
    if (!Array.isArray(list)) return permissions;
    const added = list.flatMap((permission) => (typeof permission === "string" && TENANT_SETTINGS_OF[permission] ? [TENANT_SETTINGS_OF[permission]] : []));
    return JSON.stringify([...new Set([...list, ...added])]);
}

/**
 * Groups, users with their sign-ins, and API keys. A group of the same name or a user of the same
 * email here takes the one of the file and keeps its id. A file holds one group per user, from
 * before tenants, which becomes their group in the home tenant. The SuperAdmin group of a file is
 * the group with every permission here, and its people become platform admins.
 */
export async function importUsers({ tx, data, ids, known, notes }: ImportContext): Promise<void> {
    const fullAccessIds = new Set<string>();
    for (const fileGroup of data.groups) {
        const group = { ...fileGroup, permissions: withTenantSettings(fileGroup.permissions) };
        if (group.name === LEGACY_SUPER_ADMIN) {
            const full = await ensureFullAccessGroup(tx);
            ids.groups.set(group.id, full);
            fullAccessIds.add(full);
            continue;
        }
        const existingByName = await tx.group.findFirst({ where: { name: group.name } });
        const existingById = await tx.group.findUnique({ where: { id: group.id }, select: { fullAccess: true, templateId: true } });
        // An ordinary group of the file never merges into the group with every permission, which
        // may share its name, like Admin, nor into a group the platform makes for the tenants,
        // which only its template changes. It comes in under a name of its own.
        if (existingByName?.fullAccess || existingById?.fullAccess || existingByName?.templateId || existingById?.templateId) {
            const name = await freeGroupName(tx, `${group.name} (imported)`);
            const created = await tx.group.create({ data: { name, permissions: group.permissions }, select: { id: true } });
            ids.groups.set(group.id, created.id);
            const why = existingByName?.fullAccess || existingById?.fullAccess ? "holds every permission here" : "is a group the platform makes for its tenants";
            notes.push(`The group ${group.name} of the file came in as ${name}, since ${group.name} ${why}.`);
            continue;
        }
        if (existingByName && existingByName.id !== group.id) {
            await tx.group.update({ where: { id: existingByName.id }, data: { permissions: group.permissions, updatedAt: group.updatedAt } });
            ids.groups.set(group.id, existingByName.id);
        } else {
            await tx.group.upsert({ where: { id: group.id }, create: group, update: group });
        }
    }

    const withoutSecondFactor: string[] = [];
    for (const user of data.users) {
        const { accounts, groupId: fileGroupId, ...userFields } = user as typeof user & { groupId?: string | null };
        const groupId = fileGroupId ? idHere(ids.groups, fileGroupId) : null;

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

        if (groupId && (await tx.group.findUnique({ where: { id: groupId }, select: { id: true } }))) {
            await tx.tenantMembership.upsert({
                where: { userId_tenantId: { userId, tenantId: HOME_TENANT_ID } },
                create: { userId, tenantId: HOME_TENANT_ID, groupId },
                update: { groupId },
            });
            // A platform admin holds every right on the platform, so no platform group besides.
            if (fullAccessIds.has(groupId)) await tx.user.update({ where: { id: userId }, data: { platformRole: PLATFORM_ADMIN_ROLE, platformGroupId: null } });
        }

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

/**
 * Sign-in providers, their secrets encrypted again with the key of this DBackup. A file from before
 * the tenants holds providers of the platform. One that a tenant holds here by the same id or
 * provider id stays the tenant's and is left out, since the file would write over its issuer, its
 * secret and its group.
 */
export async function importSsoProviders({ tx, data, ids, notes }: ImportContext): Promise<void> {
    for (const provider of data.ssoProviders) {
        const providerData = { ...provider, tenantId: null };
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
        const sameId = await tx.ssoProvider.findUnique({ where: { id: providerData.id }, select: { tenantId: true } });
        if (existingSso?.tenantId || sameId?.tenantId) {
            notes.push(`The sign-in provider ${providerData.name} of the file was left out, since a tenant has a provider of the same name here.`);
            continue;
        }
        if (existingSso && existingSso.id !== providerData.id) {
            const { id: _id, ...ssoUpdateFields } = providerData;
            await tx.ssoProvider.update({ where: { id: existingSso.id }, data: ssoUpdateFields });
        } else {
            await tx.ssoProvider.upsert({ where: { id: providerData.id }, create: providerData, update: providerData });
        }
    }
}
