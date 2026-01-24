import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getUserPermissions } from "@/lib/access-control";
import { PERMISSIONS } from "@/lib/permissions";
import prisma from "@/lib/prisma";
import { SystemSettingsForm } from "@/components/settings/system-settings-form";
import { SystemTasksSettings } from "@/components/settings/system-tasks-settings";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default async function SettingsPage() {
    const headersList = await headers();
    const session = await auth.api.getSession({
        headers: headersList
    });

    if (!session) {
        redirect("/login");
    }

    const permissions = await getUserPermissions();
    if (!permissions.includes(PERMISSIONS.SETTINGS.READ)) {
        redirect("/dashboard");
    }

    // Load Settings
    const maxJobsSetting = await prisma.systemSetting.findUnique({ where: { key: "maxConcurrentJobs" } });
    const maxConcurrentJobs = maxJobsSetting ? parseInt(maxJobsSetting.value) : 1;

    const disablePasskeySetting = await prisma.systemSetting.findUnique({ where: { key: "auth.disablePasskeyLogin" } });
    const disablePasskeyLogin = disablePasskeySetting?.value === 'true';

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                   <h2 className="text-3xl font-bold tracking-tight">System Settings</h2>
                   <p className="text-muted-foreground">Configure global system parameters.</p>
                </div>
            </div>

            <Tabs defaultValue="general" className="space-y-4">
                <TabsList>
                    <TabsTrigger value="general">General</TabsTrigger>
                    <TabsTrigger value="tasks">System Tasks</TabsTrigger>
                </TabsList>
                <TabsContent value="general" className="space-y-4">
                    <SystemSettingsForm
                        initialMaxConcurrentJobs={maxConcurrentJobs}
                        initialDisablePasskeyLogin={disablePasskeyLogin}
                    />
                </TabsContent>
                <TabsContent value="tasks" className="space-y-4">
                    <SystemTasksSettings />
                </TabsContent>
            </Tabs>
        </div>
    );
}
