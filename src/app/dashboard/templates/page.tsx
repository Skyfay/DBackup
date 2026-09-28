import { Suspense } from "react";
import { redirect } from "next/navigation";
import { TemplatesClient } from "@/components/dashboard/templates/templates-client";
import { TEMPLATE_TABLE_IDS } from "@/components/dashboard/templates/template-tables";
import { getCurrentUserWithGroup, getUserPermissions } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getTemplateCounts } from "@/services/templates/templates-model";
import { getTablePreferences } from "@/services/user/preference-service";

/**
 * The Templates page: retention policies, file names, schedule presets, notifications and exclude
 * patterns. The lists load in the browser, the page only resolves who may do what.
 */
export default async function TemplatesPage() {
    const [permissions, user] = await Promise.all([getUserPermissions(), getCurrentUserWithGroup()]);
    if (!user) redirect("/login");
    if (!permissions.includes(PERMISSIONS.TEMPLATES.READ)) redirect("/dashboard");

    const [counts, layouts] = await Promise.all([getTemplateCounts(), getTablePreferences(user.id, Object.values(TEMPLATE_TABLE_IDS))]);

    return (
        <div className="space-y-4 md:space-y-6">
            {/* The header bar already names the page in its breadcrumb. */}
            <h1 className="sr-only">Templates</h1>
            <Suspense fallback={null}>
                <TemplatesClient counts={counts} layouts={layouts} canManage={permissions.includes(PERMISSIONS.TEMPLATES.WRITE)} />
            </Suspense>
        </div>
    );
}
