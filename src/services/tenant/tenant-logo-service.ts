/**
 * The logo of a tenant, which the head of the sidebar, the tenant switcher and the Tenants page
 * show in place of its initials. It lives in the database like the pictures of the people, so a
 * configuration backup brings it back. A logo is checked by its first bytes, never by its name,
 * and an SVG is refused like for a picture of a person, since it could carry a script.
 */

import prisma from "@/lib/prisma";
import { imageTypeOf, type ImageType } from "@/lib/core/image-type";
import { NotFoundError, ValidationError } from "@/lib/logging/errors";

/** A logo is small, a tile of 30 pixels at most shows it. */
export const TENANT_LOGO_MAX_BYTES = 1024 * 1024;

/** What the tenant settings say about the logo kept now. */
export interface TenantLogoInfo {
    url: string;
    mimeType: string;
    size: number;
    updatedAt: string;
}

/** Where a logo is served. The time changes with the logo, so a browser never keeps an old one. */
export function tenantLogoUrl(tenantId: string, updatedAt: Date): string {
    return `/api/tenants/${encodeURIComponent(tenantId)}/logo?v=${updatedAt.getTime()}`;
}

/** The address of the logo of a tenant, null without one, from what a query selected of it. */
export function logoUrlOf(tenantId: string, logo: { updatedAt: Date } | null | undefined): string | null {
    return logo ? tenantLogoUrl(tenantId, logo.updatedAt) : null;
}

/** The logo of a tenant as the tenant settings show it, null without one. */
export async function getTenantLogoInfo(tenantId: string): Promise<TenantLogoInfo | null> {
    const row = await prisma.tenantLogo.findUnique({ where: { tenantId }, select: { mimeType: true, size: true, updatedAt: true } });
    return row ? { url: tenantLogoUrl(tenantId, row.updatedAt), mimeType: row.mimeType, size: row.size, updatedAt: row.updatedAt.toISOString() } : null;
}

/**
 * A new logo of a tenant in place of the one before, answered with its address. Throws a
 * ValidationError for a file it refuses: empty, too large, or no PNG, JPG, GIF or WebP by its bytes.
 */
export async function saveTenantLogo(tenantId: string, bytes: Uint8Array): Promise<{ url: string; replaced: boolean }> {
    if (bytes.length === 0) throw new ValidationError("The file is empty.", { field: "logo" });
    if (bytes.length > TENANT_LOGO_MAX_BYTES) throw new ValidationError("The logo is larger than 1 MB.", { field: "logo" });
    const mimeType: ImageType | null = imageTypeOf(bytes);
    if (!mimeType) throw new ValidationError("Only a PNG, JPG, GIF or WebP picture works as a logo.", { field: "logo" });

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, logo: { select: { tenantId: true } } } });
    if (!tenant) throw new NotFoundError("Tenant", tenantId);
    const fields = { mimeType, size: bytes.length, data: Buffer.from(bytes) };
    const saved = await prisma.tenantLogo.upsert({ where: { tenantId }, create: { tenantId, ...fields }, update: fields, select: { updatedAt: true } });
    return { url: tenantLogoUrl(tenantId, saved.updatedAt), replaced: tenant.logo !== null };
}

/** Removes the logo of a tenant, which shows its initials again. Says whether there was one. */
export async function removeTenantLogo(tenantId: string): Promise<boolean> {
    const { count } = await prisma.tenantLogo.deleteMany({ where: { tenantId } });
    return count > 0;
}

/** The bytes of the logo of a tenant with the type read when it was stored, null without one. */
export async function findTenantLogo(tenantId: string): Promise<{ data: Uint8Array; mimeType: string } | null> {
    const row = await prisma.tenantLogo.findUnique({ where: { tenantId }, select: { data: true, mimeType: true } });
    return row ? { data: new Uint8Array(row.data), mimeType: row.mimeType } : null;
}

/** Who may see the logo of a tenant: a platform admin, and the people and keys of that tenant. */
export interface LogoViewer {
    userId: string;
    isPlatformAdmin: boolean;
    authMethod: "session" | "apikey";
    /** The tenant the request acts in, null in All tenants or without a tenant. */
    tenantId: string | null;
}

/**
 * Whether the viewer may see the logo of the tenant: a platform admin always, a key in its own
 * tenant, a person who works in it or whose platform group reaches it, like the switcher lists it.
 * Someone else gets the same answer as for a tenant without a logo, so the route tells nothing
 * about other tenants.
 */
export async function mayViewTenantLogo(viewer: LogoViewer, tenantId: string): Promise<boolean> {
    if (viewer.isPlatformAdmin) return true;
    if (viewer.tenantId === tenantId) return true;
    if (viewer.authMethod === "apikey") return false;
    const [membership, user] = await Promise.all([
        prisma.tenantMembership.findUnique({ where: { userId_tenantId: { userId: viewer.userId, tenantId } }, select: { tenantId: true } }),
        prisma.user.findUnique({ where: { id: viewer.userId }, select: { platformGroup: { select: { allTenants: true, tenants: { select: { tenantId: true } } } } } }),
    ]);
    const group = user?.platformGroup;
    return membership !== null || Boolean(group && (group.allTenants || group.tenants.some((entry) => entry.tenantId === tenantId)));
}
