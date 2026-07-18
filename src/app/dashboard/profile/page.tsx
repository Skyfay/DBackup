import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { headers } from "next/headers";
import { TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProfileTabsRoot } from "@/components/settings/profile-tabs-root";
import { AppearanceForm } from "@/components/settings/appearance-form";
import { ProfileForm } from "@/components/settings/profile-form";
import { SecurityForm } from "@/components/settings/security-form";
import { PreferencesForm } from "@/components/settings/preferences-form";
import { SessionsForm } from "@/components/settings/sessions-form";
import { SsoForm } from "@/components/settings/sso-form";
import { redirect } from "next/navigation";
import { getUserPermissions } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";

export default async function ProfilePage() {
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
    const canManageSso = permissions.includes(PERMISSIONS.PROFILE.MANAGE_SSO);

    // Fetch user preferences directly from DB (session doesn't include all fields)
    const userPreferences = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { autoRedirectOnJobStart: true },
    });

    const hasPassword = await prisma.account.findFirst({
        where: {
            userId: session.user.id,
            providerId: "credential"
        }
    }).then(acc => !!acc);

    // Hide the SSO tab entirely when there's nothing to show or manage: no
    // provider is configured system-wide, and this user has no (possibly
    // orphaned) SSO account linked either.
    const [hasAnySsoProvider, hasLinkedSsoAccount] = await Promise.all([
        prisma.ssoProvider.count().then(count => count > 0),
        prisma.account.count({
            where: { userId: session.user.id, NOT: { providerId: "credential" } }
        }).then(count => count > 0),
    ]);
    const showSsoTab = hasAnySsoProvider || hasLinkedSsoAccount;

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h2 className="text-3xl font-bold tracking-tight">Profile</h2>
            </div>

            <ProfileTabsRoot>
                <TabsList>
                    <TabsTrigger value="profile">Profile</TabsTrigger>
                    <TabsTrigger value="appearance">Appearance</TabsTrigger>
                    <TabsTrigger value="preferences">Preferences</TabsTrigger>
                    <TabsTrigger value="security">Security</TabsTrigger>
                    <TabsTrigger value="sessions">Sessions</TabsTrigger>
                    {showSsoTab && <TabsTrigger value="sso">SSO</TabsTrigger>}
                </TabsList>

                <TabsContent value="profile" className="space-y-4">
                    <ProfileForm
                        user={{
                            ...session.user,
                            timezone: session.user.timezone || "",
                            dateFormat: session.user.dateFormat || "P",
                            timeFormat: session.user.timeFormat || "p",
                            passkeyTwoFactor: session.user.passkeyTwoFactor || false,
                            twoFactorEnabled: session.user.twoFactorEnabled || false,
                            image: session.user.image || null,
                            groupId: (session.user as any).groupId || null,
                            autoRedirectOnJobStart: (session.user as any).autoRedirectOnJobStart ?? true
                        }}
                        canUpdateName={canUpdateName}
                        canUpdateEmail={canUpdateEmail}
                    />
                </TabsContent>
                <TabsContent value="appearance" className="space-y-4">
                    <AppearanceForm />
                </TabsContent>
                <TabsContent value="preferences" className="space-y-4">
                    <PreferencesForm
                        userId={session.user.id}
                        autoRedirectOnJobStart={userPreferences?.autoRedirectOnJobStart ?? true}
                    />
                </TabsContent>
                <TabsContent value="security" className="space-y-4">
                    <SecurityForm
                        canUpdatePassword={canUpdatePassword}
                        canManage2FA={canManage2FA}
                        canManagePasskeys={canManagePasskeys}
                        hasPassword={hasPassword}
                    />
                </TabsContent>
                <TabsContent value="sessions" className="space-y-4">
                    <SessionsForm />
                </TabsContent>
                {showSsoTab && (
                    <TabsContent value="sso" className="space-y-4">
                        <SsoForm canManageSso={canManageSso} />
                    </TabsContent>
                )}
            </ProfileTabsRoot>
        </div>
    );
}
