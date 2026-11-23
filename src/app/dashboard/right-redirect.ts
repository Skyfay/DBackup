import { redirect } from "next/navigation";
import { getViewer, hasPermissionWithContext, type Viewer } from "@/lib/auth/access-control";
import type { Permission } from "@/lib/auth/permissions";

/**
 * The viewer of a page that needs `permission` to load, like the pages that redirect on their own.
 * Someone without it lands on the Overview instead of the error page a `checkPermission` would
 * show, and a request without a session on the login page. Called before the page loads anything.
 */
export async function redirectWithoutRight(permission: Permission): Promise<Viewer> {
    const viewer = await getViewer();
    if (!viewer) redirect("/");
    if (!hasPermissionWithContext(viewer, permission)) redirect("/dashboard");
    return viewer;
}
