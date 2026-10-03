import prisma from "@/lib/prisma";
import { capToOwner, groupPermissions, type OwnerGroup } from "@/lib/auth/owner-permissions";
import { runsOutSoon, type ApiKeyRow, type ApiKeysModel, type ApiKeyState } from "./api-keys-types";

/** The trigger a run started with an API key stores, with the name of the key as its label. */
export const API_TRIGGER = "Api";

export interface ListedKey {
    id: string;
    name: string;
    prefix: string;
    permissions: string;
    enabled: boolean;
    expiresAt: Date | null;
    lastUsedAt: Date | null;
    createdAt: Date;
    user: { id: string; name: string; email: string; image: string | null; group: OwnerGroup | null };
}

export interface ListedRun {
    triggerLabel: string | null;
    startedAt: Date;
    status: string;
    job: { name: string } | null;
}

/** Reading is looking at something. Everything else, like running a job or a download, does more. */
export const readsOnly = (permission: string) => permission.endsWith(":read") || permission.endsWith(":view");

function parse(json: string): string[] {
    try {
        const value: unknown = JSON.parse(json);
        return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
    } catch {
        return [];
    }
}

export function stateOf(key: Pick<ListedKey, "enabled" | "expiresAt">, now: number): ApiKeyState {
    if (key.expiresAt && key.expiresAt.getTime() <= now) return "expired";
    return key.enabled ? "enabled" : "disabled";
}

interface BuildInput {
    keys: ListedKey[];
    /** The newest run per key name, started through the API. */
    runs: ListedRun[];
    viewer: { id: string; superAdmin: boolean; permissions: string[] };
    now?: number;
}

/** The API keys tab: every key with what it may do now, and the numbers above the list. */
export function buildApiKeysModel({ keys, runs, viewer, now = Date.now() }: BuildInput): ApiKeysModel {
    const lastRuns = new Map(runs.flatMap((run) => (run.triggerLabel ? [[run.triggerLabel, run] as const] : [])));

    const rows: ApiKeyRow[] = keys
        .map((key) => {
            const permissions = parse(key.permissions);
            const effective = capToOwner(permissions, key.user.group);
            // A deleted key may have had the same name, its runs are older than this key.
            const named = lastRuns.get(key.name);
            const run = named && named.startedAt >= key.createdAt ? named : undefined;
            return {
                id: key.id,
                name: key.name,
                prefix: key.prefix,
                permissions,
                effective,
                paused: permissions.filter((permission) => !effective.includes(permission)),
                ownerPermissions: groupPermissions(key.user.group),
                owner: { id: key.user.id, name: key.user.name, email: key.user.email, image: key.user.image, groupName: key.user.group?.name ?? null },
                state: stateOf(key, now),
                expiresAt: key.expiresAt?.toISOString() ?? null,
                lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
                createdAt: key.createdAt.toISOString(),
                lastRun: run ? { job: run.job?.name ?? null, at: run.startedAt.toISOString(), status: run.status } : null,
                isMine: key.user.id === viewer.id,
            };
        })
        .sort((a, b) => a.name.localeCompare(b.name));

    const working = rows.filter((row) => row.state === "enabled");
    return {
        keys: rows,
        stats: {
            keys: rows.length,
            working: working.length,
            disabled: rows.filter((row) => row.state === "disabled").length,
            expired: rows.filter((row) => row.state === "expired").length,
            soon: rows.filter((row) => runsOutSoon(row, now)).map((row) => row.name),
            never: rows.filter((row) => !row.lastUsedAt).map((row) => row.name),
            beyondReading: rows.filter((row) => row.effective.some((permission) => !readsOnly(permission))).map((row) => row.name),
            owners: [...new Set(rows.map((row) => row.owner.name))].sort((a, b) => a.localeCompare(b)),
        },
        viewer,
    };
}

/** Loads the API keys tab. The hash of a key never leaves the database. */
export async function getApiKeysModel(viewer: { id: string; superAdmin: boolean; permissions: string[] }): Promise<ApiKeysModel> {
    const keys = await prisma.apiKey.findMany({
        select: {
            id: true,
            name: true,
            prefix: true,
            permissions: true,
            enabled: true,
            expiresAt: true,
            lastUsedAt: true,
            createdAt: true,
            user: { select: { id: true, name: true, email: true, image: true, group: { select: { name: true, permissions: true } } } },
        },
    });
    // One run per key, the newest, since the rows come newest first.
    const runs = keys.length === 0
        ? []
        : await prisma.execution.findMany({
              where: { triggerType: API_TRIGGER, triggerLabel: { in: keys.map((key) => key.name) } },
              orderBy: { startedAt: "desc" },
              distinct: ["triggerLabel"],
              select: { triggerLabel: true, startedAt: true, status: true, job: { select: { name: true } } },
          });
    return buildApiKeysModel({ keys, runs, viewer });
}
