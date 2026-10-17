import type { Tx } from "@/lib/prisma-tx";
import { AVAILABLE_PERMISSIONS } from "@/lib/auth/permissions";
import { seedTemplateGroups } from "@/services/user/tenant-group-templates";

/**
 * The built-in templates a new tenant starts with, the same the migrations gave the first one: the
 * retention policies, the naming template, the schedule presets and the exclude preset. A tenant
 * changes or deletes its own without touching those of the others.
 */

const RETENTION = [
    { name: "Keep All", description: "Never delete any backups automatically.", config: '{"mode":"NONE"}' },
    { name: "Simple - 14 Days", description: "Keep the last 14 backups.", config: '{"mode":"SIMPLE","simple":{"keepCount":14}}' },
    {
        name: "Smart GVS (7/4/12/2)",
        description: "Grandfather-Father-Son: keep 7 daily, 4 weekly, 12 monthly, 2 yearly backups.",
        config: '{"mode":"SMART","smart":{"daily":7,"weekly":4,"monthly":12,"yearly":2}}',
    },
];

const SCHEDULES = [
    { name: "Daily at Midnight", description: "Runs every day at 00:00.", schedule: "0 0 * * *" },
    { name: "Daily at 3 AM", description: "Runs every day at 03:00.", schedule: "0 3 * * *" },
    { name: "Weekly on Sunday", description: "Runs every Sunday at 02:00.", schedule: "0 2 * * 0" },
    { name: "Every Hour", description: "Runs at the start of every hour.", schedule: "0 * * * *" },
    { name: "Monthly on 1st", description: "Runs on the 1st of every month at 04:00.", schedule: "0 4 1 * *" },
];

/**
 * The groups a new tenant starts with: Admin, which may do everything in the tenant, and every
 * group the platform gives all tenants, like a Viewer or a Client made once under Platform. The
 * tenant's admins add their own from there.
 */
export async function seedTenantGroups(tx: Tx, tenantId: string): Promise<void> {
    await seedTemplateGroups(tx, tenantId);
    await tx.group.create({ data: { tenantId, name: "Admin", fullAccess: true, permissions: JSON.stringify(AVAILABLE_PERMISSIONS.map((permission) => permission.id)) } });
}

/** Writes the built-in templates into a tenant, inside the transaction that creates it. */
export async function seedTenantTemplates(tx: Tx, tenantId: string): Promise<void> {
    await tx.retentionPolicy.createMany({ data: RETENTION.map((policy) => ({ ...policy, tenantId, isSystem: true })) });
    await tx.namingTemplate.create({
        data: {
            tenantId,
            name: "Standard",
            description: "Default naming pattern: {job_name}_date_time",
            pattern: "{job_name}_yyyy-MM-dd_HH-mm-ss",
            isDefault: true,
            isSystem: true,
        },
    });
    await tx.schedulePreset.createMany({ data: SCHEDULES.map((preset) => ({ ...preset, tenantId })) });
    await tx.excludePatternPreset.create({
        data: {
            tenantId,
            name: "System Junk Files",
            description: "Operating system clutter that no backup needs: macOS .DS_Store, Windows Thumbs.db and desktop.ini.",
            patterns: '[".DS_Store","._*",".Spotlight-V100",".Trashes","Thumbs.db","ehthumbs.db","desktop.ini"]',
            isDefault: true,
            isSystem: true,
        },
    });
}
