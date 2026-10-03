import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUserWithGroup, getUserPermissions } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { SettingsClient } from "@/components/dashboard/settings/settings-client";
import { getSettingsModel } from "@/services/system/settings-model";

/** The name of the browser tab, which the root layout ends with the name of the instance. */
export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
    const [permissions, user] = await Promise.all([getUserPermissions(), getCurrentUserWithGroup()]);
    if (!permissions.includes(PERMISSIONS.SETTINGS.READ)) {
        redirect("/dashboard");
    }

    const model = await getSettingsModel({
        canManage: permissions.includes(PERMISSIONS.SETTINGS.WRITE),
        isSuperAdmin: user?.group?.name === "SuperAdmin",
        permissions,
    });

    return (
        <>
            {/* The header bar already names the page in its breadcrumb. */}
            <h1 className="sr-only">Settings</h1>
            <SettingsClient model={model} viewerName={user?.name || user?.email || "Admin"} />
        </>
    );
}
