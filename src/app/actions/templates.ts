"use server";

import { z } from "zod";
import { checkPermission, getUserPermissions } from "@/lib/auth/access-control";
import { PERMISSIONS } from "@/lib/auth/permissions";
import * as retentionPolicyService from "@/services/templates/retention-policy-service";
import * as namingTemplateService from "@/services/templates/naming-template-service";
import * as schedulePresetService from "@/services/templates/schedule-preset-service";
import * as notificationTemplateService from "@/services/templates/notification-template-service";
import * as excludePatternPresetService from "@/services/templates/exclude-pattern-preset-service";
import type { NotificationTemplateChannelInput } from "@/services/templates/notification-template-service";
import { defaultNotificationTemplate, templateSnapshot, templateUpdate } from "@/services/templates/template-audit";
import { revalidatePath } from "next/cache";
import { scheduler } from "@/lib/server/scheduler";
import { logger } from "@/lib/logging/logger";
import { auditService } from "@/services/audit-service";
import { AUDIT_ACTIONS, AUDIT_RESOURCES } from "@/lib/core/audit-types";
import { getErrorMessage } from "@/lib/logging/errors";
import type { RetentionConfiguration } from "@/lib/core/retention";

/**
 * Who reads the lists of templates: the Templates page, and the job form and the pickers that use
 * them. The settings of the instance give no right to the templates of a tenant.
 */
const TEMPLATE_READERS = [PERMISSIONS.TEMPLATES.READ, PERMISSIONS.TEMPLATES.WRITE, PERMISSIONS.JOBS.READ, PERMISSIONS.JOBS.WRITE];

const mayReadTemplates = (permissions: string[]) => TEMPLATE_READERS.some((permission) => permissions.includes(permission));

const IdSchema = z.string().min(1).max(200);

// ---------------------------------------------------------------------------
// Retention Policies
// ---------------------------------------------------------------------------

export async function getRetentionPolicies() {
  if (!mayReadTemplates(await getUserPermissions())) return { success: false as const, error: "Insufficient permissions" };

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
  const user = await checkPermission(PERMISSIONS.TEMPLATES.WRITE);

  try {
    const policy = await retentionPolicyService.createRetentionPolicy(input);
    await auditService.log(
      user.id,
      AUDIT_ACTIONS.CREATE,
      AUDIT_RESOURCES.TEMPLATE,
      { type: "RetentionPolicy", name: input.name },
      policy.id
    );
    revalidatePath("/dashboard/templates");
    revalidatePath("/dashboard/jobs");
    revalidatePath("/dashboard/connections");
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
  const user = await checkPermission(PERMISSIONS.TEMPLATES.WRITE);

  const parsed = IdSchema.safeParse(id);
  if (!parsed.success) return { success: false as const, error: "Invalid request" };

  try {
    const before = await templateSnapshot("RetentionPolicy", parsed.data);
    const policy = await retentionPolicyService.updateRetentionPolicy(parsed.data, input);
    await auditService.log(
      user.id,
      AUDIT_ACTIONS.UPDATE,
      AUDIT_RESOURCES.TEMPLATE,
      templateUpdate("RetentionPolicy", before, await templateSnapshot("RetentionPolicy", parsed.data)),
      parsed.data
    );
    revalidatePath("/dashboard/templates");
    revalidatePath("/dashboard/jobs");
    revalidatePath("/dashboard/connections");
    return { success: true as const, data: policy };
  } catch (e: unknown) {
    return { success: false as const, error: getErrorMessage(e) };
  }
}

export async function deleteRetentionPolicy(id: string) {
  const user = await checkPermission(PERMISSIONS.TEMPLATES.WRITE);

  const parsed = IdSchema.safeParse(id);
  if (!parsed.success) return { success: false as const, error: "Invalid request" };

  try {
    const deleted = await retentionPolicyService.deleteRetentionPolicy(parsed.data);
    await auditService.log(
      user.id,
      AUDIT_ACTIONS.DELETE,
      AUDIT_RESOURCES.TEMPLATE,
      { type: "RetentionPolicy", name: deleted.name },
      parsed.data
    );
    revalidatePath("/dashboard/templates");
    revalidatePath("/dashboard/jobs");
    revalidatePath("/dashboard/connections");
    return { success: true as const };
  } catch (e: unknown) {
    return { success: false as const, error: getErrorMessage(e) };
  }
}

export async function setDefaultRetentionPolicy(id: string) {
  const user = await checkPermission(PERMISSIONS.TEMPLATES.WRITE);

  const parsed = IdSchema.safeParse(id);
  if (!parsed.success) return { success: false as const, error: "Invalid request" };

  try {
    const policy = await retentionPolicyService.setDefaultRetentionPolicy(parsed.data);
    await auditService.log(
      user.id,
      AUDIT_ACTIONS.UPDATE,
      AUDIT_RESOURCES.TEMPLATE,
      { type: "RetentionPolicy", action: "setDefault", name: policy.name },
      parsed.data
    );
    revalidatePath("/dashboard/templates");
    revalidatePath("/dashboard/jobs");
    return { success: true as const, data: policy };
  } catch (e: unknown) {
    return { success: false as const, error: getErrorMessage(e) };
  }
}

// ---------------------------------------------------------------------------
// Naming Templates
// ---------------------------------------------------------------------------

export async function getNamingTemplates() {
  if (!mayReadTemplates(await getUserPermissions())) return { success: false as const, error: "Insufficient permissions" };

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
  const user = await checkPermission(PERMISSIONS.TEMPLATES.WRITE);

  try {
    const template = await namingTemplateService.createNamingTemplate(input);
    await auditService.log(
      user.id,
      AUDIT_ACTIONS.CREATE,
      AUDIT_RESOURCES.TEMPLATE,
      { type: "NamingTemplate", name: input.name },
      template.id
    );
    revalidatePath("/dashboard/templates");
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
  const user = await checkPermission(PERMISSIONS.TEMPLATES.WRITE);

  const parsed = IdSchema.safeParse(id);
  if (!parsed.success) return { success: false as const, error: "Invalid request" };

  try {
    const before = await templateSnapshot("NamingTemplate", parsed.data);
    const template = await namingTemplateService.updateNamingTemplate(parsed.data, input);
    await auditService.log(
      user.id,
      AUDIT_ACTIONS.UPDATE,
      AUDIT_RESOURCES.TEMPLATE,
      templateUpdate("NamingTemplate", before, await templateSnapshot("NamingTemplate", parsed.data)),
      parsed.data
    );
    revalidatePath("/dashboard/templates");
    revalidatePath("/dashboard/jobs");
    return { success: true as const, data: template };
  } catch (e: unknown) {
    return { success: false as const, error: getErrorMessage(e) };
  }
}

export async function deleteNamingTemplate(id: string) {
  const user = await checkPermission(PERMISSIONS.TEMPLATES.WRITE);

  const parsed = IdSchema.safeParse(id);
  if (!parsed.success) return { success: false as const, error: "Invalid request" };

  try {
    const deleted = await namingTemplateService.deleteNamingTemplate(parsed.data);
    await auditService.log(
      user.id,
      AUDIT_ACTIONS.DELETE,
      AUDIT_RESOURCES.TEMPLATE,
      { type: "NamingTemplate", name: deleted.name },
      parsed.data
    );
    revalidatePath("/dashboard/templates");
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
  if (!mayReadTemplates(await getUserPermissions())) return { success: false as const, error: "Insufficient permissions" };

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
  const user = await checkPermission(PERMISSIONS.TEMPLATES.WRITE);

  try {
    const preset = await schedulePresetService.createSchedulePreset(input);
    await auditService.log(
      user.id,
      AUDIT_ACTIONS.CREATE,
      AUDIT_RESOURCES.TEMPLATE,
      { type: "SchedulePreset", name: input.name },
      preset.id
    );
    revalidatePath("/dashboard/templates");
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
  const user = await checkPermission(PERMISSIONS.TEMPLATES.WRITE);

  const parsed = IdSchema.safeParse(id);
  if (!parsed.success) return { success: false as const, error: "Invalid request" };

  try {
    const before = await templateSnapshot("SchedulePreset", parsed.data);
    const preset = await schedulePresetService.updateSchedulePreset(parsed.data, input);
    await auditService.log(
      user.id,
      AUDIT_ACTIONS.UPDATE,
      AUDIT_RESOURCES.TEMPLATE,
      templateUpdate("SchedulePreset", before, await templateSnapshot("SchedulePreset", parsed.data)),
      parsed.data
    );
    revalidatePath("/dashboard/templates");
    revalidatePath("/dashboard/jobs");
    // Trigger scheduler refresh so all jobs linked to this preset pick up the new schedule immediately
    const log = logger.child({ action: "updateSchedulePreset" });
    scheduler.refresh().catch((e) => log.error("Scheduler refresh failed after preset update", { presetId: parsed.data }, e));
    return { success: true as const, data: preset };
  } catch (e: unknown) {
    return { success: false as const, error: getErrorMessage(e) };
  }
}

export async function deleteSchedulePreset(id: string) {
  const user = await checkPermission(PERMISSIONS.TEMPLATES.WRITE);

  const parsed = IdSchema.safeParse(id);
  if (!parsed.success) return { success: false as const, error: "Invalid request" };

  try {
    const deleted = await schedulePresetService.deleteSchedulePreset(parsed.data);
    await auditService.log(
      user.id,
      AUDIT_ACTIONS.DELETE,
      AUDIT_RESOURCES.TEMPLATE,
      { type: "SchedulePreset", name: deleted.name },
      parsed.data
    );
    revalidatePath("/dashboard/templates");
    revalidatePath("/dashboard/jobs");
    // The jobs that followed the preset run on the copy of its schedule they got now.
    const log = logger.child({ action: "deleteSchedulePreset" });
    scheduler.refresh().catch((e) => log.error("Scheduler refresh failed after preset delete", { presetId: parsed.data }, e));
    return { success: true as const };
  } catch (e: unknown) {
    return { success: false as const, error: getErrorMessage(e) };
  }
}

// ---------------------------------------------------------------------------
// Notification Templates
// ---------------------------------------------------------------------------

export async function getNotificationTemplates() {
  if (!mayReadTemplates(await getUserPermissions())) return { success: false as const, error: "Insufficient permissions" };

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
  const user = await checkPermission(PERMISSIONS.TEMPLATES.WRITE);

  try {
    const template = await notificationTemplateService.createNotificationTemplate(input);
    await auditService.log(
      user.id,
      AUDIT_ACTIONS.CREATE,
      AUDIT_RESOURCES.TEMPLATE,
      { type: "NotificationTemplate", name: input.name },
      template.id
    );
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
  const user = await checkPermission(PERMISSIONS.TEMPLATES.WRITE);

  const parsed = IdSchema.safeParse(id);
  if (!parsed.success) return { success: false as const, error: "Invalid request" };

  try {
    const before = await templateSnapshot("NotificationTemplate", parsed.data);
    const template = await notificationTemplateService.updateNotificationTemplate(parsed.data, input);
    await auditService.log(
      user.id,
      AUDIT_ACTIONS.UPDATE,
      AUDIT_RESOURCES.TEMPLATE,
      templateUpdate("NotificationTemplate", before, await templateSnapshot("NotificationTemplate", parsed.data)),
      parsed.data
    );
    revalidatePath("/dashboard/templates");
    revalidatePath("/dashboard/jobs");
    return { success: true as const, data: template };
  } catch (e: unknown) {
    return { success: false as const, error: getErrorMessage(e) };
  }
}

export async function deleteNotificationTemplate(id: string) {
  const user = await checkPermission(PERMISSIONS.TEMPLATES.WRITE);

  const parsed = IdSchema.safeParse(id);
  if (!parsed.success) return { success: false as const, error: "Invalid request" };

  try {
    const deleted = await notificationTemplateService.deleteNotificationTemplate(parsed.data);
    await auditService.log(
      user.id,
      AUDIT_ACTIONS.DELETE,
      AUDIT_RESOURCES.TEMPLATE,
      { type: "NotificationTemplate", name: deleted.name },
      parsed.data
    );
    revalidatePath("/dashboard/templates");
    revalidatePath("/dashboard/jobs");
    return { success: true as const };
  } catch (e: unknown) {
    return { success: false as const, error: getErrorMessage(e) };
  }
}

export async function setDefaultNotificationTemplate(id: string) {
  const user = await checkPermission(PERMISSIONS.TEMPLATES.WRITE);

  const parsed = IdSchema.safeParse(id);
  if (!parsed.success) return { success: false as const, error: "Invalid request" };

  try {
    const template = await notificationTemplateService.setDefaultNotificationTemplate(parsed.data);
    await auditService.log(
      user.id,
      AUDIT_ACTIONS.UPDATE,
      AUDIT_RESOURCES.TEMPLATE,
      { type: "NotificationTemplate", action: "setDefault", name: template.name },
      parsed.data
    );
    revalidatePath("/dashboard/templates");
    return { success: true as const, data: template };
  } catch (e: unknown) {
    return { success: false as const, error: getErrorMessage(e) };
  }
}

export async function unsetDefaultNotificationTemplate() {
  const user = await checkPermission(PERMISSIONS.TEMPLATES.WRITE);

  try {
    // Read first, afterwards no template is the default.
    const previous = await defaultNotificationTemplate();
    await notificationTemplateService.unsetDefaultNotificationTemplate();
    if (previous) {
      await auditService.log(
        user.id,
        AUDIT_ACTIONS.UPDATE,
        AUDIT_RESOURCES.TEMPLATE,
        { type: "NotificationTemplate", name: previous.name, changes: [{ field: "Default", from: "On", to: "Off" }] },
        previous.id
      );
    }
    revalidatePath("/dashboard/templates");
    return { success: true as const };
  } catch (e: unknown) {
    return { success: false as const, error: getErrorMessage(e) };
  }
}

// ---------------------------------------------------------------------------
// Exclude Pattern Presets
// ---------------------------------------------------------------------------

export async function getExcludePatternPresets() {
  if (!mayReadTemplates(await getUserPermissions())) return { success: false as const, error: "Insufficient permissions" };

  try {
    const data = await excludePatternPresetService.getExcludePatternPresets();
    return { success: true as const, data };
  } catch (e: unknown) {
    return { success: false as const, error: getErrorMessage(e) };
  }
}

export async function createExcludePatternPreset(input: {
  groups?: string[];
  excludedGroupPatterns?: string[];
  name: string;
  description?: string;
  patterns: string[];
}) {
  const user = await checkPermission(PERMISSIONS.TEMPLATES.WRITE);

  try {
    const preset = await excludePatternPresetService.createExcludePatternPreset(input);
    await auditService.log(
      user.id,
      AUDIT_ACTIONS.CREATE,
      AUDIT_RESOURCES.TEMPLATE,
      { type: "ExcludePatternPreset", name: input.name },
      preset.id
    );
    revalidatePath("/dashboard/templates");
    revalidatePath("/dashboard/jobs");
    return { success: true as const, data: preset };
  } catch (e: unknown) {
    return { success: false as const, error: getErrorMessage(e) };
  }
}

export async function updateExcludePatternPreset(
  id: string,
  input: {
    name?: string;
    description?: string;
    patterns?: string[];
    groups?: string[];
    excludedGroupPatterns?: string[];
    isDefault?: boolean;
  }
) {
  const user = await checkPermission(PERMISSIONS.TEMPLATES.WRITE);

  const parsed = IdSchema.safeParse(id);
  if (!parsed.success) return { success: false as const, error: "Invalid request" };

  try {
    const before = await templateSnapshot("ExcludePatternPreset", parsed.data);
    const preset = await excludePatternPresetService.updateExcludePatternPreset(parsed.data, input);
    await auditService.log(
      user.id,
      AUDIT_ACTIONS.UPDATE,
      AUDIT_RESOURCES.TEMPLATE,
      templateUpdate("ExcludePatternPreset", before, await templateSnapshot("ExcludePatternPreset", parsed.data)),
      parsed.data
    );
    revalidatePath("/dashboard/templates");
    revalidatePath("/dashboard/jobs");
    return { success: true as const, data: preset };
  } catch (e: unknown) {
    return { success: false as const, error: getErrorMessage(e) };
  }
}

export async function deleteExcludePatternPreset(id: string) {
  const user = await checkPermission(PERMISSIONS.TEMPLATES.WRITE);

  const parsed = IdSchema.safeParse(id);
  if (!parsed.success) return { success: false as const, error: "Invalid request" };

  try {
    const deleted = await excludePatternPresetService.deleteExcludePatternPreset(parsed.data);
    await auditService.log(
      user.id,
      AUDIT_ACTIONS.DELETE,
      AUDIT_RESOURCES.TEMPLATE,
      { type: "ExcludePatternPreset", name: deleted.name },
      parsed.data
    );
    revalidatePath("/dashboard/templates");
    revalidatePath("/dashboard/jobs");
    return { success: true as const };
  } catch (e: unknown) {
    return { success: false as const, error: getErrorMessage(e) };
  }
}
