"use client";

import { hostLocalReason } from "@/lib/adapters/host-local";
import { HOME_TENANT_ID } from "@/lib/tenant/home";
import { useTenantView } from "@/components/tenant/tenant-view";

/**
 * Whether the viewer adds, changes, copies and tests connections that reach the server DBackup
 * runs on, see `host-local.ts`: a platform admin in the home tenant, or in All tenants, where a new
 * connection asks for its tenant first. The server decides again on every request.
 */
export function useMayReachServer(): boolean {
    const { isPlatformAdmin, activeTenantId } = useTenantView();
    return isPlatformAdmin && (activeTenantId === null || activeTenantId === HOME_TENANT_ID);
}

/** What a picked mode card says when only a platform admin picks it. */
export const PLATFORM_ADMIN_ONLY = "Platform admin only";

/**
 * Why the config of the connection form reaches the server DBackup runs on, or null. A saved
 * connection reaches the form with its secrets removed, so a secret it keeps counts as set, like
 * the private key of rsync, which would otherwise read as a login with the keys of the server.
 */
export function formHostLocalReason(adapterId: string, config: Record<string, unknown>, secretStatus: Record<string, boolean> = {}): string | null {
    const probe: Record<string, unknown> = { ...config };
    for (const [key, stored] of Object.entries(secretStatus)) {
        const value = probe[key];
        if (stored && (value === undefined || value === null || String(value).trim() === "")) probe[key] = "stored";
    }
    return hostLocalReason(adapterId, probe);
}

/**
 * The modes a new connection starts in for someone who may not reach the server, so the form opens
 * on a setting they may save: SQLite and SQL Server reach their files over SSH, Docker its host.
 */
export function serverFreeDefaults(adapterId: string, config: Record<string, unknown>): Record<string, unknown> {
    if (adapterId === "sqlite") return { ...config, mode: "ssh" };
    if (adapterId === "docker-volume") return { ...config, connectionMode: "ssh" };
    if (adapterId === "mssql") return { ...config, fileTransferMode: "ssh" };
    return config;
}
