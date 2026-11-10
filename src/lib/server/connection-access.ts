/**
 * Who learns that a connection exists. Connections are one table behind three permissions, so a
 * route reads the type of a connection before it knows which one to check. A caller who may neither
 * read nor change connections of that type gets the answer of a missing id, never a 403 that names
 * the permission and so the type of a connection they cannot see. Only past that the route checks
 * the write permission of the type. Change alone counts as seeing, since an API key may hold it
 * without the right to read.
 */

import { hasPermissionWithContext, type AuthContext } from "@/lib/auth/access-control";
import { getReadPermissionForAdapterType, getWritePermissionForAdapterType } from "@/lib/auth/permissions";

/** The answer of a connection that is missing or that the caller may not see. */
export const CONNECTION_NOT_FOUND = "Adapter not found";

/** The row of a bulk action for an id that is missing or that the caller may not see. */
export const CONNECTION_GONE_ROW = "The connection no longer exists.";

/** Whether the type of a connection was found and the caller may read or change connections of that type. */
export function seesConnectionType(ctx: Pick<AuthContext, "isPlatformAdmin" | "allTenants" | "permissions">, type: string | null | undefined): type is string {
    return !!type && (hasPermissionWithContext(ctx, getReadPermissionForAdapterType(type)) || hasPermissionWithContext(ctx, getWritePermissionForAdapterType(type)));
}

/** The 404 of a connection that is missing or that the caller may not see. */
export function connectionNotFound(): Response {
    return Response.json({ success: false, error: CONNECTION_NOT_FOUND }, { status: 404 });
}
