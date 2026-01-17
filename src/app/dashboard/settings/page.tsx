import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AppearanceForm } from "@/components/settings/appearance-form";
import { ProfileForm } from "@/components/settings/profile-form";
import { SecurityForm } from "@/components/settings/security-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { redirect } from "next/navigation";
import { getUserPermissions } from "@/lib/access-control";
import { PERMISSIONS } from "@/lib/permissions";

export default async function SettingsPage() {
    // Await headers() correctly as it is a Promise in newer Next.js versions
    const headersList = await headers();
    const session = await auth.api.getSession({
        headers: headersList
    });

    if (!session) {
        redirect("/login");
    }

    const permissions = await getUserPermissions();
    const canUpdateName = permissions.includes(PERMISSIONS.PROFILE.UPDATE_NAME);
    const canUpdateEmail = permissions.includes(PERMISSIONS.PROFILE.UPDATE_EMAIL);
    const canUpdatePassword = permissions.includes(PERMISSIONS.PROFILE.UPDATE_PASSWORD);
    const canManage2FA = permissions.includes(PERMISSIONS.PROFILE.MANAGE_2FA);
    const canManagePasskeys = permissions.includes(PERMISSIONS.PROFILE.MANAGE_PASSKEYS);

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h2 className="text-3xl font-bold tracking-tight">Settings</h2>
            </div>

            <Tabs defaultValue="profile" className="space-y-4">
                <TabsList>
                    <TabsTrigger value="profile">Profile</TabsTrigger>
                    <TabsTrigger value="appearance">Appearance</TabsTrigger>
                    <TabsTrigger value="security">Security</TabsTrigger>
                </TabsList>

                <TabsContent value="profile" className="space-y-4">
                    <ProfileForm
                        user={{
                            ...session.user,
                            timezone: session.user.timezone || "UTC",
                            dateFormat: session.user.dateFormat || "P",
                            timeFormat: session.user.timeFormat || "p",
                            passkeyTwoFactor: session.user.passkeyTwoFactor || false,
                            twoFactorEnabled: session.user.twoFactorEnabled || false,
                            image: session.user.image || null
                        }}
                        canUpdateName={canUpdateName}
                        canUpdateEmail={canUpdateEmail}
                    />
                </TabsContent>

                <TabsContent value="appearance" className="space-y-4">
                    <AppearanceForm />
                </TabsContent>

                <TabsContent value="security" className="space-y-4">
                    <SecurityForm
                        canUpdatePassword={canUpdatePassword}
                        canManage2FA={canManage2FA}
                        canManagePasskeys={canManagePasskeys}
                    />
                </TabsContent>
            </Tabs>
        </div>
    )
}
