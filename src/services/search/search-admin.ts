/**
 * The records of the global search that are not backups: the people, groups and API keys of Users &
 * Groups, the templates and the keys and saved logins of the Vault. Each selects what a row shows,
 * never a secret, like the key of an encryption key, the data of a login or the hash of an API key.
 * The caller decides which of them the viewer may see.
 */

import prisma from "@/lib/prisma";
import { PER_KIND, type SearchHit, type TemplateKind } from "./search-types";

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

/** The people by name or email, like the Users tab lists them. */
export async function users(query: string): Promise<SearchHit[]> {
    const found = await prisma.user.findMany({
        where: { OR: [{ name: { contains: query } }, { email: { contains: query } }] },
        orderBy: { name: "asc" },
        take: PER_KIND,
        select: { id: true, name: true, email: true, group: { select: { name: true } } },
    });
    return found.map((user) => ({ kind: "user", id: user.id, name: user.name, email: user.email, group: user.group?.name ?? null }));
}

export async function groups(query: string): Promise<SearchHit[]> {
    const found = await prisma.group.findMany({
        where: { name: { contains: query } },
        orderBy: { name: "asc" },
        take: PER_KIND,
        select: { id: true, name: true, _count: { select: { users: true } } },
    });
    return found.map((group) => ({ kind: "group", id: group.id, name: group.name, people: group._count.users }));
}

/** Every API key, like the API keys tab lists them for someone who may read them. */
export async function apiKeys(query: string): Promise<SearchHit[]> {
    const found = await prisma.apiKey.findMany({
        where: { name: { contains: query } },
        orderBy: { name: "asc" },
        take: PER_KIND,
        select: { id: true, name: true, prefix: true, enabled: true, expiresAt: true, user: { select: { name: true } } },
    });
    const now = Date.now();
    return found.map((key) => ({
        kind: "apiKey",
        id: key.id,
        name: key.name,
        prefix: key.prefix,
        owner: key.user.name,
        enabled: key.enabled,
        expired: key.expiresAt !== null && key.expiresAt.getTime() < now,
    }));
}

/** The templates of all five kinds, the first ones by name. */
export async function templates(query: string): Promise<SearchHit[]> {
    const where = { name: { contains: query } };
    const take = PER_KIND;
    const [retention, naming, schedules, notifications, excludes] = await Promise.all([
        prisma.retentionPolicy.findMany({ where, take, select: { id: true, name: true, description: true } }),
        prisma.namingTemplate.findMany({ where, take, select: { id: true, name: true, pattern: true } }),
        prisma.schedulePreset.findMany({ where, take, select: { id: true, name: true, schedule: true } }),
        prisma.notificationTemplate.findMany({ where, take, select: { id: true, name: true, description: true } }),
        prisma.excludePatternPreset.findMany({ where, take, select: { id: true, name: true, description: true } }),
    ]);
    const hit = (row: { id: string; name: string }, template: TemplateKind, detail: string | null): Extract<SearchHit, { kind: "template" }> => ({ kind: "template", id: row.id, name: row.name, template, detail });
    return [
        ...retention.map((row) => hit(row, "retention", row.description)),
        ...naming.map((row) => hit(row, "naming", row.pattern)),
        ...schedules.map((row) => hit(row, "schedules", row.schedule)),
        ...notifications.map((row) => hit(row, "notifications", row.description)),
        ...excludes.map((row) => hit(row, "excludes", row.description)),
    ].sort(byName).slice(0, PER_KIND + 1);
}

/** The encryption keys with how many jobs encrypt with each. */
export async function keys(query: string): Promise<SearchHit[]> {
    const found = await prisma.encryptionProfile.findMany({
        where: { name: { contains: query } },
        orderBy: { name: "asc" },
        take: PER_KIND,
        select: { id: true, name: true, _count: { select: { jobs: true } } },
    });
    return found.map((key) => ({ kind: "key", id: key.id, name: key.name, jobs: key._count.jobs }));
}

/** The saved logins with their kind, never what they hold. */
export async function credentials(query: string): Promise<SearchHit[]> {
    const found = await prisma.credentialProfile.findMany({
        where: { name: { contains: query } },
        orderBy: { name: "asc" },
        take: PER_KIND,
        select: { id: true, name: true, type: true },
    });
    return found.map((profile) => ({ kind: "credential", id: profile.id, name: profile.name, type: profile.type }));
}
