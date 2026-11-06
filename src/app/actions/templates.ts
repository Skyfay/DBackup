"use server";

import { z } from "zod";
import { checkPermission, tenantRefusal, type Viewer } from "@/lib/auth/access-control";
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
import { userMessage } from "@/lib/logging/user-message";
import { RetentionConfigurationSchema, type RetentionConfiguration } from "@/lib/core/retention";

/**
 * Who reads the lists of templates: the Templates page, and the job form and the pickers that use
 * them. The settings of the instance give no right to the templates of a tenant.
 */
const TEMPLATE_READERS = [PERMISSIONS.TEMPLATES.READ, PERMISSIONS.TEMPLATES.WRITE, PERMISSIONS.JOBS.READ, PERMISSIONS.JOBS.WRITE];

/**
 * Why the lists of templates stay closed to the viewer, null when they open. Templates belong to a
 * tenant and every picker asks in one, so All tenants, which would mix those of every tenant, is refused.
 */
function readRefusal(viewer: Viewer | null): string | null {
  return viewer ? tenantRefusal(viewer) : "Insufficient permissions";
}

const IdSchema = z.string().min(1).max(200);

// What each kind of template takes, checked before a service sees it. The services check the
// meaning, like a retention rule or a schedule, these the shape and the size.
const NameSchema = z.string().trim().min(1).max(200);
const DescriptionSchema = z.string().max(1000).optional();
const PatternListSchema = z.array(z.string().max(1000)).max(500);
const GroupListSchema = z.array(z.string().min(1).max(200)).max(100);

const RetentionPolicyFields = { name: NameSchema, description: DescriptionSchema, config: RetentionConfigurationSchema };
const CreateRetentionPolicySchema = z.object(RetentionPolicyFields);
const UpdateRetentionPolicySchema = z.object(RetentionPolicyFields).partial();

const NamingTemplateFields = { name: NameSchema, description: DescriptionSchema, pattern: z.string().trim().min(1).max(500), isDefault: z.boolean().optional() };
const CreateNamingTemplateSchema = z.object(NamingTemplateFields);
const UpdateNamingTemplateSchema = z.object(NamingTemplateFields).partial();

const SchedulePresetFields = { name: NameSchema, description: DescriptionSchema, schedule: z.string().trim().min(1).max(200) };
const CreateSchedulePresetSchema = z.object(SchedulePresetFields);
const UpdateSchedulePresetSchema = z.object(SchedulePresetFields).partial();

const NotificationChannelSchema = z.object({
  configId: IdSchema,
  // Pipe-separated, like "SUCCESS|PARTIAL|FAILED".
  events: z.string().max(200).regex(/^[A-Z_|]*$/, "Invalid events"),
});
const NotificationTemplateFields = { name: NameSchema, description: DescriptionSchema, channels: z.array(NotificationChannelSchema).max(100), isDefault: z.boolean().optional() };
const CreateNotificationTemplateSchema = z.object(NotificationTemplateFields);
const UpdateNotificationTemplateSchema = z.object(NotificationTemplateFields).partial();

const ExcludePresetFields = {
  name: NameSchema,
  description: DescriptionSchema,
  patterns: PatternListSchema,
  groups: GroupListSchema.optional(),
  excludedGroupPatterns: PatternListSchema.optional(),
};
const CreateExcludePatternPresetSchema = z.object(ExcludePresetFields);
const UpdateExcludePatternPresetSchema = z.object({ ...ExcludePresetFields, isDefault: z.boolean() }).partial();

/** The first problem of an input, as the dialogs show it. */
function problemOf(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Invalid request";
}

const templateLog = logger.child({ action: "templates" });

/** The answer for an error of a template action: a refusal or a conflict in its words, anything else a fixed sentence and the log. */
const failure = (error: unknown) => userMessage(error, "Something went wrong with the template. The server log has the details.", templateLog, "A template action failed");

// ---------------------------------------------------------------------------
// Retention Policies
// ---------------------------------------------------------------------------

export async function getRetentionPolicies() {
  const refused = readRefusal(await checkPermission(TEMPLATE_READERS).catch(() => null));
  if (refused) return { success: false as const, error: refused };

  try {
    const data = await retentionPolicyService.getRetentionPolicies();
    return { success: true as const, data };
  } catch (e: unknown) {
    return { success: false as const, error: failure(e) };
  }
}

export async function createRetentionPolicy(input: {
  name: string;
  description?: string;
  config: RetentionConfiguration;
}) {
  const user = await checkPermission(PERMISSIONS.TEMPLATES.WRITE);

  const parsed = CreateRetentionPolicySchema.safeParse(input);
  if (!parsed.success) return { success: false as const, error: problemOf(parsed.error) };

  try {
    const policy = await retentionPolicyService.createRetentionPolicy(parsed.data);
    await auditService.log(
      user.id,
      AUDIT_ACTIONS.CREATE,
      AUDIT_RESOURCES.TEMPLATE,
      { type: "RetentionPolicy", name: parsed.data.name },
      policy.id
    );
    revalidatePath("/dashboard/templates");
    revalidatePath("/dashboard/jobs");
    revalidatePath("/dashboard/connections");
    return { success: true as const, data: policy };
  } catch (e: unknown) {
    return { success: false as const, error: failure(e) };
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
  const fields = UpdateRetentionPolicySchema.safeParse(input);
  if (!fields.success) return { success: false as const, error: problemOf(fields.error) };

  try {
    const before = await templateSnapshot("RetentionPolicy", parsed.data);
    const policy = await retentionPolicyService.updateRetentionPolicy(parsed.data, fields.data);
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
    return { success: false as const, error: failure(e) };
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
    return { success: false as const, error: failure(e) };
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
    return { success: false as const, error: failure(e) };
  }
}

// ---------------------------------------------------------------------------
// Naming Templates
// ---------------------------------------------------------------------------

export async function getNamingTemplates() {
  const refused = readRefusal(await checkPermission(TEMPLATE_READERS).catch(() => null));
  if (refused) return { success: false as const, error: refused };

  try {
    const data = await namingTemplateService.getNamingTemplates();
    return { success: true as const, data };
  } catch (e: unknown) {
    return { success: false as const, error: failure(e) };
  }
}

export async function createNamingTemplate(input: {
  name: string;
  description?: string;
  pattern: string;
  isDefault?: boolean;
}) {
  const user = await checkPermission(PERMISSIONS.TEMPLATES.WRITE);

  const parsed = CreateNamingTemplateSchema.safeParse(input);
  if (!parsed.success) return { success: false as const, error: problemOf(parsed.error) };

  try {
    const template = await namingTemplateService.createNamingTemplate(parsed.data);
    await auditService.log(
      user.id,
      AUDIT_ACTIONS.CREATE,
      AUDIT_RESOURCES.TEMPLATE,
      { type: "NamingTemplate", name: parsed.data.name },
      template.id
    );
    revalidatePath("/dashboard/templates");
    revalidatePath("/dashboard/jobs");
    return { success: true as const, data: template };
  } catch (e: unknown) {
    return { success: false as const, error: failure(e) };
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
  const fields = UpdateNamingTemplateSchema.safeParse(input);
  if (!fields.success) return { success: false as const, error: problemOf(fields.error) };

  try {
    const before = await templateSnapshot("NamingTemplate", parsed.data);
    const template = await namingTemplateService.updateNamingTemplate(parsed.data, fields.data);
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
    return { success: false as const, error: failure(e) };
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
    return { success: false as const, error: failure(e) };
  }
}

// ---------------------------------------------------------------------------
// Schedule Presets
// ---------------------------------------------------------------------------

export async function getSchedulePresets() {
  const refused = readRefusal(await checkPermission(TEMPLATE_READERS).catch(() => null));
  if (refused) return { success: false as const, error: refused };

  try {
    const data = await schedulePresetService.getSchedulePresets();
    return { success: true as const, data };
  } catch (e: unknown) {
    return { success: false as const, error: failure(e) };
  }
}

export async function createSchedulePreset(input: {
  name: string;
  description?: string;
  schedule: string;
}) {
  const user = await checkPermission(PERMISSIONS.TEMPLATES.WRITE);

  const parsed = CreateSchedulePresetSchema.safeParse(input);
  if (!parsed.success) return { success: false as const, error: problemOf(parsed.error) };

  try {
    const preset = await schedulePresetService.createSchedulePreset(parsed.data);
    await auditService.log(
      user.id,
      AUDIT_ACTIONS.CREATE,
      AUDIT_RESOURCES.TEMPLATE,
      { type: "SchedulePreset", name: parsed.data.name },
      preset.id
    );
    revalidatePath("/dashboard/templates");
    revalidatePath("/dashboard/jobs");
    return { success: true as const, data: preset };
  } catch (e: unknown) {
    return { success: false as const, error: failure(e) };
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
  const fields = UpdateSchedulePresetSchema.safeParse(input);
  if (!fields.success) return { success: false as const, error: problemOf(fields.error) };

  try {
    const before = await templateSnapshot("SchedulePreset", parsed.data);
    const preset = await schedulePresetService.updateSchedulePreset(parsed.data, fields.data);
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
    return { success: false as const, error: failure(e) };
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
    return { success: false as const, error: failure(e) };
  }
}

// ---------------------------------------------------------------------------
// Notification Templates
// ---------------------------------------------------------------------------

export async function getNotificationTemplates() {
  const refused = readRefusal(await checkPermission(TEMPLATE_READERS).catch(() => null));
  if (refused) return { success: false as const, error: refused };

  try {
    const data = await notificationTemplateService.getNotificationTemplates();
    return { success: true as const, data };
  } catch (e: unknown) {
    return { success: false as const, error: failure(e) };
  }
}

export async function createNotificationTemplate(input: {
  name: string;
  description?: string;
  channels: NotificationTemplateChannelInput[];
  isDefault?: boolean;
}) {
  const user = await checkPermission(PERMISSIONS.TEMPLATES.WRITE);

  const parsed = CreateNotificationTemplateSchema.safeParse(input);
  if (!parsed.success) return { success: false as const, error: problemOf(parsed.error) };

  try {
    const template = await notificationTemplateService.createNotificationTemplate(parsed.data);
    await auditService.log(
      user.id,
      AUDIT_ACTIONS.CREATE,
      AUDIT_RESOURCES.TEMPLATE,
      { type: "NotificationTemplate", name: parsed.data.name },
      template.id
    );
    revalidatePath("/dashboard/templates");
    revalidatePath("/dashboard/jobs");
    return { success: true as const, data: template };
  } catch (e: unknown) {
    return { success: false as const, error: failure(e) };
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
  const fields = UpdateNotificationTemplateSchema.safeParse(input);
  if (!fields.success) return { success: false as const, error: problemOf(fields.error) };

  try {
    const before = await templateSnapshot("NotificationTemplate", parsed.data);
    const template = await notificationTemplateService.updateNotificationTemplate(parsed.data, fields.data);
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
    return { success: false as const, error: failure(e) };
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
    return { success: false as const, error: failure(e) };
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
    return { success: false as const, error: failure(e) };
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
    return { success: false as const, error: failure(e) };
  }
}

// ---------------------------------------------------------------------------
// Exclude Pattern Presets
// ---------------------------------------------------------------------------

export async function getExcludePatternPresets() {
  const refused = readRefusal(await checkPermission(TEMPLATE_READERS).catch(() => null));
  if (refused) return { success: false as const, error: refused };

  try {
    const data = await excludePatternPresetService.getExcludePatternPresets();
    return { success: true as const, data };
  } catch (e: unknown) {
    return { success: false as const, error: failure(e) };
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

  const parsed = CreateExcludePatternPresetSchema.safeParse(input);
  if (!parsed.success) return { success: false as const, error: problemOf(parsed.error) };

  try {
    const preset = await excludePatternPresetService.createExcludePatternPreset(parsed.data);
    await auditService.log(
      user.id,
      AUDIT_ACTIONS.CREATE,
      AUDIT_RESOURCES.TEMPLATE,
      { type: "ExcludePatternPreset", name: parsed.data.name },
      preset.id
    );
    revalidatePath("/dashboard/templates");
    revalidatePath("/dashboard/jobs");
    return { success: true as const, data: preset };
  } catch (e: unknown) {
    return { success: false as const, error: failure(e) };
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
  const fields = UpdateExcludePatternPresetSchema.safeParse(input);
  if (!fields.success) return { success: false as const, error: problemOf(fields.error) };

  try {
    const before = await templateSnapshot("ExcludePatternPreset", parsed.data);
    const preset = await excludePatternPresetService.updateExcludePatternPreset(parsed.data, fields.data);
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
    return { success: false as const, error: failure(e) };
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
    return { success: false as const, error: failure(e) };
  }
}
