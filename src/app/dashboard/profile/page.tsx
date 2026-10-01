import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUserWithGroup, getUserPermissions } from "@/lib/auth/access-control";
import { ProfileClient } from "@/components/dashboard/profile/profile-client";
import { getProfileModel } from "@/services/user/profile-model";

/** The name of the browser tab, which the root layout ends with the name of the instance. */
export const metadata: Metadata = { title: "Profile" };

export default async function ProfilePage() {
    const [permissions, user] = await Promise.all([getUserPermissions(), getCurrentUserWithGroup()]);
    if (!user) {
        redirect("/");
    }

    const model = await getProfileModel(user.id, { permissions, isSuperAdmin: user.group?.name === "SuperAdmin" });

    return (
        <>
            {/* The header bar already names the page in its breadcrumb. */}
            <h1 className="sr-only">Profile</h1>
            <ProfileClient model={model} />
        </>
    );
}
