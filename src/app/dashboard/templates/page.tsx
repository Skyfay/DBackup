import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getUserPermissions } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { RetentionPolicyList } from "@/components/settings/templates/retention-policy-list";
import { NamingTemplateList } from "@/components/settings/templates/naming-template-list";
import { SchedulePresetList } from "@/components/settings/templates/schedule-preset-list";
import { NotificationTemplateList } from "@/components/settings/templates/notification-template-list";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import prisma from "@/lib/prisma";

export default async function TemplatesPage() {
    const headersList = await headers();
    const session = await auth.api.getSession({
        headers: headersList
    });

    if (!session) {
        redirect("/login");
    }

    const permissions = await getUserPermissions();
    if (!permissions.includes(PERMISSIONS.TEMPLATES.READ)) {
        redirect("/dashboard");
    }

    const notificationChannels = await prisma.adapterConfig.findMany({
        where: { type: "notification" },
        orderBy: { name: "asc" },
    });

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Templates</h2>
                    <p className="text-muted-foreground">Manage reusable retention policies, naming templates, schedule presets, and notification templates for your backup jobs.</p>
                </div>
            </div>

            <Tabs defaultValue="retention" className="w-full">
                <TabsList>
                    <TabsTrigger value="retention">Retention Policies</TabsTrigger>
                    <TabsTrigger value="naming">Naming Templates</TabsTrigger>
                    <TabsTrigger value="presets">Schedule Presets</TabsTrigger>
                    <TabsTrigger value="notifications">Notification Templates</TabsTrigger>
                </TabsList>

                <TabsContent value="retention" className="mt-4">
                    <RetentionPolicyList />
                </TabsContent>

                <TabsContent value="naming" className="mt-4">
                    <NamingTemplateList />
                </TabsContent>

                <TabsContent value="presets" className="mt-4">
                    <SchedulePresetList />
                </TabsContent>

                <TabsContent value="notifications" className="mt-4">
                    <NotificationTemplateList availableChannels={notificationChannels} />
                </TabsContent>
            </Tabs>
        </div>
    );
}
