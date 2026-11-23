import prisma from "@/lib/prisma";

/**
 * The names of the records a bulk route changes, read before it changes them, so its entry in the
 * audit log names them (`names`) even once they are deleted. Read in the scope of the request, so
 * a record of another tenant has no name here.
 */

const byId = (rows: { id: string; name: string }[]) => new Map(rows.map((row) => [row.id, row.name]));

export async function jobNames(ids: readonly string[]): Promise<Map<string, string>> {
    return byId(await prisma.job.findMany({ where: { id: { in: [...ids] } }, select: { id: true, name: true } }));
}

export async function connectionNames(ids: readonly string[]): Promise<Map<string, string>> {
    return byId(await prisma.adapterConfig.findMany({ where: { id: { in: [...ids] } }, select: { id: true, name: true } }));
}

export async function credentialNames(ids: readonly string[]): Promise<Map<string, string>> {
    return byId(await prisma.credentialProfile.findMany({ where: { id: { in: [...ids] } }, select: { id: true, name: true } }));
}

/** The names of the records that changed, in the order of the result. */
export const changedNames = (succeeded: readonly string[], names: ReadonlyMap<string, string>): string[] => succeeded.flatMap((id) => names.get(id) ?? []);

/**
 * The name and the tenant of a connection, for an entry that goes into the log of the tenant the
 * connection belongs to. In All tenants no tenant runs, so the entry would land in the home log
 * otherwise. Null for a connection the scope of the request does not see.
 */
export async function connectionPlace(id: string): Promise<{ name: string; tenantId: string } | null> {
    return prisma.adapterConfig.findUnique({ where: { id }, select: { name: true, tenantId: true } });
}

/** The name and the tenant of a saved login, like `connectionPlace` for a check of its token. */
export async function credentialPlace(id: string): Promise<{ name: string; tenantId: string } | null> {
    return prisma.credentialProfile.findUnique({ where: { id }, select: { name: true, tenantId: true } });
}
