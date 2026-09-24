"use client";

import { createContext, useContext } from "react";
import type { Permission } from "@/lib/auth/permissions";

/** The permissions of the viewer, as the dashboard layout resolved them on the server. */
const PermissionsContext = createContext<readonly string[] | null>(null);

export function PermissionsProvider({ permissions, children }: { permissions: readonly string[]; children: React.ReactNode }) {
    return <PermissionsContext.Provider value={permissions}>{children}</PermissionsContext.Provider>;
}

/**
 * Whether the viewer holds a permission, for leaving out what they could not use, like New in a
 * field deep inside a form. It only hides, the server checks every request. Outside the dashboard,
 * like in a test, nothing is hidden.
 */
export function useCan(permission: Permission): boolean {
    const permissions = useContext(PermissionsContext);
    return permissions === null || permissions.includes(permission);
}
