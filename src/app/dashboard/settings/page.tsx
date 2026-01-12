import { AppearanceForm } from "@/components/settings/appearance-form";
import { AccountForm } from "@/components/settings/account-form";
import { SecurityForm } from "@/components/settings/security-form";
import { PasskeyList } from "@/components/settings/passkey-list";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { getPasskeys } from "@/actions/passkeys";

export default async function SettingsPage() {
    const session = await auth();
    const user = session?.user || {};

    // Fetch user details including 2FA status from DB since session might be stale or not include it
    let isTwoFactorEnabled = false;
    if (user.email) {
        const dbUser = await prisma.user.findUnique({
            where: { email: user.email },
            select: { isTwoFactorEnabled: true }
        });
        isTwoFactorEnabled = dbUser?.isTwoFactorEnabled || false;
    }

    const passkeys = await getPasskeys();

    return (
         <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h2 className="text-3xl font-bold tracking-tight">Settings</h2>
            </div>
             <Tabs defaultValue="account" className="space-y-4">
                <TabsList>
                    <TabsTrigger value="account">Account</TabsTrigger>
                    <TabsTrigger value="security">Security</TabsTrigger>
                    <TabsTrigger value="appearance">Appearance</TabsTrigger>
                </TabsList>
                <TabsContent value="account" className="space-y-4">
                    <AccountForm user={user} />
                </TabsContent>
                <TabsContent value="security" className="space-y-6">
                    <SecurityForm isTwoFactorEnabled={isTwoFactorEnabled} />
                    <PasskeyList passkeys={passkeys} />
                </TabsContent>
                <TabsContent value="appearance" className="space-y-4">
                     <AppearanceForm />
                </TabsContent>
            </Tabs>
        </div>
    )
}
