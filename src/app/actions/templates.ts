"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { checkPermission, getUserPermissions } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import * as retentionPolicyService from "@/services/templates/retention-policy-service";
import * as namingTemplateService from "@/services/templates/naming-template-service";
import * as schedulePresetService from "@/services/templates/schedule-preset-service";
import * as notificationTemplateService from "@/services/templates/notification-template-service";
import type { NotificationTemplateChannelInput } from "@/services/templates/notification-template-service";
import { revalidatePath } from "next/cache";
import { scheduler } from "@/lib/server/scheduler";
import { logger } from "@/lib/logging/logger";
import { auditService } from "@/services/audit-service";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { getErrorMessage } from "@/lib/logging/errors";
import type { RetentionConfiguration } from "@/lib/core/retention";

// ---------------------------------------------------------------------------
// Retention Policies
// ---------------------------------------------------------------------------

export async function getRetentionPolicies() {
  const headersList = await headers();
  const session = await auth.api.getSession({ headers: headersList });
  if (!session) return { success: false as const, error: "Unauthorized" };

  const permissions = await getUserPermissions();
  const hasAccess =
    permissions.includes(PERMISSIONS.TEMPLATES.READ) ||
    permissions.includes(PERMISSIONS.TEMPLATES.WRITE) ||
    permissions.includes(PERMISSIONS.JOBS.READ) ||
    permissions.includes(PERMISSIONS.JOBS.WRITE) ||
    permissions.includes(PERMISSIONS.SETTINGS.READ);
  if (!hasAccess) return { success: false as const, error: "Insufficient permissions" };

  try {
    const data = await retentionPolicyService.getRetentionPolicies();
    return { success: true as const, data };
  } catch (e: unknown) {
    return { success: false as const, error: getErrorMessage(e) };
  }
}

export async function createRetentionPolicy(input: {
  name: string;
  description?: string;
  config: RetentionConfiguration;
}) {
  const headersList = await headers();
  const session = await auth.api.getSession({ headers: headersList });
  if (!session) return { success: false as const, error: "Unauthorized" };

  await checkPermission(PERMISSIONS.TEMPLATES.WRITE);

  try {
    const policy = await retentionPolicyService.createRetentionPolicy(input);
    if (session.user) {
      await auditService.log(
        session.user.id,
        AUDIT_ACTIONS.CREATE,
        AUDIT_RESOURCES.TEMPLATE,
        { type: "RetentionPolicy", name: input.name },
        policy.id
      );
    }
    revalidatePath("/dashboard/vault");
    revalidatePath("/dashboard/jobs");
    revalidatePath("/dashboard/destinations");
    return { success: true as const, data: policy };
  } catch (e: unknown) {
    return { success: false as const, error: getErrorMessage(e) };
  }
}

export async function updateRetentionPolicy(
  id: string,
  input: {
    name?: string;
    description?: string;
    config?: RetentionConfiguration;
  }
) {
  const headersList = await headers();
  const session = await auth.api.getSession({ headers: headersList });
  if (!session) return { success: false as const, error: "Unauthorized" };

  await checkPermission(PERMISSIONS.TEMPLATES.WRITE);

  try {
    const policy = await retentionPolicyService.updateRetentionPolicy(id, input);
    if (session.user) {
      await auditService.log(
        session.user.id,
        AUDIT_ACTIONS.UPDATE,
        AUDIT_RESOURCES.TEMPLATE,
        { type: "RetentionPolicy" },
        id
      );
    }
    revalidatePath("/dashboard/vault");
    revalidatePath("/dashboard/jobs");
    revalidatePath("/dashboard/destinations");
    return { success: true as const, data: policy };
  } catch (e: unknown) {
    return { success: false as const, error: getErrorMessage(e) };
  }
}

export async function deleteRetentionPolicy(id: string) {
  const headersList = await headers();
  const session = await auth.api.getSession({ headers: headersList });
  if (!session) return { success: false as const, error: "Unauthorized" };

  await checkPermission(PERMISSIONS.TEMPLATES.WRITE);

  try {
    await retentionPolicyService.deleteRetentionPolicy(id);
    if (session.user) {
      await auditService.log(
        session.user.id,
        AUDIT_ACTIONS.DELETE,
        AUDIT_RESOURCES.TEMPLATE,
        { type: "RetentionPolicy" },
        id
      );
    }
    revalidatePath("/dashboard/vault");
    revalidatePath("/dashboard/jobs");
    revalidatePath("/dashboard/destinations");
    return { success: true as const };
  } catch (e: unknown) {
    return { success: false as const, error: getErrorMessage(e) };
  }
}

export async function setDefaultRetentionPolicy(id: string) {
  const headersList = await headers();
  const session = await auth.api.getSession({ headers: headersList });
  if (!session) return { success: false as const, error: "Unauthorized" };

  await checkPermission(PERMISSIONS.TEMPLATES.WRITE);

  try {
    const policy = await retentionPolicyService.setDefaultRetentionPolicy(id);
    if (session.user) {
      await auditService.log(
        session.user.id,
        AUDIT_ACTIONS.UPDATE,
        AUDIT_RESOURCES.TEMPLATE,
        { type: "RetentionPolicy", action: "setDefault" },
        id
      );
    }
    revalidatePath("/dashboard/vault");
    revalidatePath("/dashboard/jobs");
    return { success: true as const, data: policy };
  } catch (e: unknown) {
    return { success: false as const, error: getErrorMessage(e) };
  }
}

export async function unsetDefaultRetentionPolicy() {
  const headersList = await headers();
  const session = await auth.api.getSession({ headers: headersList });
  if (!session) return { success: false as const, error: "Unauthorized" };

  await checkPermission(PERMISSIONS.TEMPLATES.WRITE);

  try {
    await retentionPolicyService.unsetDefaultRetentionPolicy();
    revalidatePath("/dashboard/vault");
    revalidatePath("/dashboard/jobs");
    return { success: true as const };
  } catch (e: unknown) {
    return { success: false as const, error: getErrorMessage(e) };
  }
}

// ---------------------------------------------------------------------------
// Naming Templates
// ---------------------------------------------------------------------------

export async function getNamingTemplates() {
  const headersList = await headers();
  const session = await auth.api.getSession({ headers: headersList });
  if (!session) return { success: false as const, error: "Unauthorized" };

  const permissions = await getUserPermissions();
  const hasAccess =
    permissions.includes(PERMISSIONS.TEMPLATES.READ) ||
    permissions.includes(PERMISSIONS.TEMPLATES.WRITE) ||
    permissions.includes(PERMISSIONS.JOBS.READ) ||
    permissions.includes(PERMISSIONS.JOBS.WRITE) ||
    permissions.includes(PERMISSIONS.SETTINGS.READ);
  if (!hasAccess) return { success: false as const, error: "Insufficient permissions" };

  try {
    const data = await namingTemplateService.getNamingTemplates();
    return { success: true as const, data };
  } catch (e: unknown) {
    return { success: false as const, error: getErrorMessage(e) };
  }
}

export async function createNamingTemplate(input: {
  name: string;
  description?: string;
  pattern: string;
  isDefault?: boolean;
}) {
  const headersList = await headers();
  const session = await auth.api.getSession({ headers: headersList });
  if (!session) return { success: false as const, error: "Unauthorized" };

  await checkPermission(PERMISSIONS.TEMPLATES.WRITE);

  try {
    const template = await namingTemplateService.createNamingTemplate(input);
    if (session.user) {
      await auditService.log(
        session.user.id,
        AUDIT_ACTIONS.CREATE,
        AUDIT_RESOURCES.TEMPLATE,
        { type: "NamingTemplate", name: input.name },
        template.id
      );
    }
    revalidatePath("/dashboard/vault");
    revalidatePath("/dashboard/jobs");
    return { success: true as const, data: template };
  } catch (e: unknown) {
    return { success: false as const, error: getErrorMessage(e) };
  }
}

export async function updateNamingTemplate(
  id: string,
  input: {
    name?: string;
    description?: string;
    pattern?: string;
    isDefault?: boolean;
  }
) {
  const headersList = await headers();
  const session = await auth.api.getSession({ headers: headersList });
  if (!session) return { success: false as const, error: "Unauthorized" };

  await checkPermission(PERMISSIONS.TEMPLATES.WRITE);

  try {
    const template = await namingTemplateService.updateNamingTemplate(id, input);
    if (session.user) {
      await auditService.log(
        session.user.id,
        AUDIT_ACTIONS.UPDATE,
        AUDIT_RESOURCES.TEMPLATE,
        { type: "NamingTemplate" },
        id
      );
    }
    revalidatePath("/dashboard/vault");
    revalidatePath("/dashboard/jobs");
    return { success: true as const, data: template };
  } catch (e: unknown) {
    return { success: false as const, error: getErrorMessage(e) };
  }
}

export async function deleteNamingTemplate(id: string) {
  const headersList = await headers();
  const session = await auth.api.getSession({ headers: headersList });
  if (!session) return { success: false as const, error: "Unauthorized" };

  await checkPermission(PERMISSIONS.TEMPLATES.WRITE);

  try {
    await namingTemplateService.deleteNamingTemplate(id);
    if (session.user) {
      await auditService.log(
        session.user.id,
        AUDIT_ACTIONS.DELETE,
        AUDIT_RESOURCES.TEMPLATE,
        { type: "NamingTemplate" },
        id
      );
    }
    revalidatePath("/dashboard/vault");
    revalidatePath("/dashboard/jobs");
    return { success: true as const };
  } catch (e: unknown) {
    return { success: false as const, error: getErrorMessage(e) };
  }
}

// ---------------------------------------------------------------------------
// Schedule Presets
// ---------------------------------------------------------------------------

export async function getSchedulePresets() {
  const headersList = await headers();
  const session = await auth.api.getSession({ headers: headersList });
  if (!session) return { success: false as const, error: "Unauthorized" };

  const permissions = await getUserPermissions();
  const hasAccess =
    permissions.includes(PERMISSIONS.TEMPLATES.READ) ||
    permissions.includes(PERMISSIONS.TEMPLATES.WRITE) ||
    permissions.includes(PERMISSIONS.JOBS.READ) ||
    permissions.includes(PERMISSIONS.JOBS.WRITE) ||
    permissions.includes(PERMISSIONS.SETTINGS.READ);
  if (!hasAccess) return { success: false as const, error: "Insufficient permissions" };

  try {
    const data = await schedulePresetService.getSchedulePresets();
    return { success: true as const, data };
  } catch (e: unknown) {
    return { success: false as const, error: getErrorMessage(e) };
  }
}

export async function createSchedulePreset(input: {
  name: string;
  description?: string;
  schedule: string;
}) {
  const headersList = await headers();
  const session = await auth.api.getSession({ headers: headersList });
  if (!session) return { success: false as const, error: "Unauthorized" };

  await checkPermission(PERMISSIONS.TEMPLATES.WRITE);

  try {
    const preset = await schedulePresetService.createSchedulePreset(input);
    if (session.user) {
      await auditService.log(
        session.user.id,
        AUDIT_ACTIONS.CREATE,
        AUDIT_RESOURCES.TEMPLATE,
        { type: "SchedulePreset", name: input.name },
        preset.id
      );
    }
    revalidatePath("/dashboard/vault");
    revalidatePath("/dashboard/jobs");
    return { success: true as const, data: preset };
  } catch (e: unknown) {
    return { success: false as const, error: getErrorMessage(e) };
  }
}

export async function updateSchedulePreset(
  id: string,
  input: {
    name?: string;
    description?: string;
    schedule?: string;
  }
) {
  const headersList = await headers();
  const session = await auth.api.getSession({ headers: headersList });
  if (!session) return { success: false as const, error: "Unauthorized" };

  await checkPermission(PERMISSIONS.TEMPLATES.WRITE);

  try {
    const preset = await schedulePresetService.updateSchedulePreset(id, input);
    if (session.user) {
      await auditService.log(
        session.user.id,
        AUDIT_ACTIONS.UPDATE,
        AUDIT_RESOURCES.TEMPLATE,
        { type: "SchedulePreset" },
        id
      );
    }
    revalidatePath("/dashboard/vault");
    revalidatePath("/dashboard/jobs");
    // Trigger scheduler refresh so all jobs linked to this preset pick up the new schedule immediately
    const log = logger.child({ action: "updateSchedulePreset" });
    scheduler.refresh().catch((e) => log.error("Scheduler refresh failed after preset update", { presetId: id }, e));
    return { success: true as const, data: preset };
  } catch (e: unknown) {
    return { success: false as const, error: getErrorMessage(e) };
  }
}

export async function deleteSchedulePreset(id: string) {
  const headersList = await headers();
  const session = await auth.api.getSession({ headers: headersList });
  if (!session) return { success: false as const, error: "Unauthorized" };

  await checkPermission(PERMISSIONS.TEMPLATES.WRITE);

  try {
    await schedulePresetService.deleteSchedulePreset(id);
    if (session.user) {
      await auditService.log(
        session.user.id,
        AUDIT_ACTIONS.DELETE,
        AUDIT_RESOURCES.TEMPLATE,
        { type: "SchedulePreset" },
        id
      );
    }
    revalidatePath("/dashboard/vault");
    revalidatePath("/dashboard/jobs");
    return { success: true as const };
  } catch (e: unknown) {
    return { success: false as const, error: getErrorMessage(e) };
  }
}

// ---------------------------------------------------------------------------
// Notification Templates
// ---------------------------------------------------------------------------

export async function getNotificationTemplates() {
  const headersList = await headers();
  const session = await auth.api.getSession({ headers: headersList });
  if (!session) return { success: false as const, error: "Unauthorized" };

  const permissions = await getUserPermissions();
  const hasAccess =
    permissions.includes(PERMISSIONS.TEMPLATES.READ) ||
    permissions.includes(PERMISSIONS.TEMPLATES.WRITE) ||
    permissions.includes(PERMISSIONS.JOBS.READ) ||
    permissions.includes(PERMISSIONS.JOBS.WRITE) ||
    permissions.includes(PERMISSIONS.SETTINGS.READ);
  if (!hasAccess) return { success: false as const, error: "Insufficient permissions" };

  try {
    const data = await notificationTemplateService.getNotificationTemplates();
    return { success: true as const, data };
  } catch (e: unknown) {
    return { success: false as const, error: getErrorMessage(e) };
  }
}

export async function createNotificationTemplate(input: {
  name: string;
  description?: string;
  channels: NotificationTemplateChannelInput[];
  isDefault?: boolean;
}) {
  const headersList = await headers();
  const session = await auth.api.getSession({ headers: headersList });
  if (!session) return { success: false as const, error: "Unauthorized" };

  await checkPermission(PERMISSIONS.TEMPLATES.WRITE);

  try {
    const template = await notificationTemplateService.createNotificationTemplate(input);
    if (session.user) {
      await auditService.log(
        session.user.id,
        AUDIT_ACTIONS.CREATE,
        AUDIT_RESOURCES.TEMPLATE,
        { type: "NotificationTemplate", name: input.name },
        template.id
      );
    }
    revalidatePath("/dashboard/templates");
    revalidatePath("/dashboard/jobs");
    return { success: true as const, data: template };
  } catch (e: unknown) {
    return { success: false as const, error: getErrorMessage(e) };
  }
}

export async function updateNotificationTemplate(
  id: string,
  input: {
    name?: string;
    description?: string;
    channels?: NotificationTemplateChannelInput[];
    isDefault?: boolean;
  }
) {
  const headersList = await headers();
  const session = await auth.api.getSession({ headers: headersList });
  if (!session) return { success: false as const, error: "Unauthorized" };

  await checkPermission(PERMISSIONS.TEMPLATES.WRITE);

  try {
    const template = await notificationTemplateService.updateNotificationTemplate(id, input);
    if (session.user) {
      await auditService.log(
        session.user.id,
        AUDIT_ACTIONS.UPDATE,
        AUDIT_RESOURCES.TEMPLATE,
        { type: "NotificationTemplate" },
        id
      );
    }
    revalidatePath("/dashboard/templates");
    revalidatePath("/dashboard/jobs");
    return { success: true as const, data: template };
  } catch (e: unknown) {
    return { success: false as const, error: getErrorMessage(e) };
  }
}

export async function deleteNotificationTemplate(id: string) {
  const headersList = await headers();
  const session = await auth.api.getSession({ headers: headersList });
  if (!session) return { success: false as const, error: "Unauthorized" };

  await checkPermission(PERMISSIONS.TEMPLATES.WRITE);

  try {
    await notificationTemplateService.deleteNotificationTemplate(id);
    if (session.user) {
      await auditService.log(
        session.user.id,
        AUDIT_ACTIONS.DELETE,
        AUDIT_RESOURCES.TEMPLATE,
        { type: "NotificationTemplate" },
        id
      );
    }
    revalidatePath("/dashboard/templates");
    revalidatePath("/dashboard/jobs");
    return { success: true as const };
  } catch (e: unknown) {
    return { success: false as const, error: getErrorMessage(e) };
  }
}

export async function setDefaultNotificationTemplate(id: string) {
  const headersList = await headers();
  const session = await auth.api.getSession({ headers: headersList });
  if (!session) return { success: false as const, error: "Unauthorized" };

  await checkPermission(PERMISSIONS.TEMPLATES.WRITE);

  try {
    const template = await notificationTemplateService.setDefaultNotificationTemplate(id);
    revalidatePath("/dashboard/templates");
    return { success: true as const, data: template };
  } catch (e: unknown) {
    return { success: false as const, error: getErrorMessage(e) };
  }
}

export async function unsetDefaultNotificationTemplate() {
  const headersList = await headers();
  const session = await auth.api.getSession({ headers: headersList });
  if (!session) return { success: false as const, error: "Unauthorized" };

  await checkPermission(PERMISSIONS.TEMPLATES.WRITE);

  try {
    await notificationTemplateService.unsetDefaultNotificationTemplate();
    revalidatePath("/dashboard/templates");
    return { success: true as const };
  } catch (e: unknown) {
    return { success: false as const, error: getErrorMessage(e) };
  }
}
