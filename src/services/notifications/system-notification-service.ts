/**
 * System Notification Service
 *
 * Sends notifications for system-level events (user login, backup results, etc.)
 * through user-configured notification channels.
 *
 * Configuration is stored in SystemSetting (key: "notifications.config") as JSON.
 * Channels reference existing AdapterConfig entries of type "notification".
 */

import prisma from "@/lib/prisma";
import { HOME_TENANT_ID } from "@/lib/tenant/home";
import { runAsSystem } from "@/lib/tenant/context";
import { registerAdapters } from "@/lib/adapters";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";
import { renderTemplate } from "@/lib/notifications/templates";
import { getEventDefinition } from "@/lib/notifications/events";
import {
  NotificationEventData,
  SystemNotificationConfig,
  NOTIFICATION_EVENTS,
} from "@/lib/notifications/types";
import { loadNotificationBrand } from "@/lib/notifications/brand";
import { eventReason, userReason } from "@/services/notifications/notification-reason";
import { EMAIL_ADAPTER_IDS, sendThroughChannel } from "./channel-send";
import { deliverToTenant, eventTenant, type DeliveryResult } from "./tenant-notification-delivery";

const log = logger.child({ service: "SystemNotificationService" });

const SETTING_KEY = "notifications.config";

/** Default configuration when none exists yet */
function defaultConfig(): SystemNotificationConfig {
  return { globalChannels: [], events: {} };
}

// ── Config Management ──────────────────────────────────────────

/** Load the persisted notification config from SystemSetting */
export async function getNotificationConfig(): Promise<SystemNotificationConfig> {
  const row = await prisma.systemSetting.findUnique({
    where: { key: SETTING_KEY },
  });
  if (!row) return defaultConfig();

  try {
    return JSON.parse(row.value) as SystemNotificationConfig;
  } catch {
    log.warn("Invalid notification config JSON, returning defaults");
    return defaultConfig();
  }
}

/** Persist the notification config to SystemSetting */
export async function saveNotificationConfig(
  config: SystemNotificationConfig
): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { key: SETTING_KEY },
    update: { value: JSON.stringify(config) },
    create: {
      key: SETTING_KEY,
      value: JSON.stringify(config),
      description: "System notification settings (channels & events)",
    },
  });
}

/** Return all AdapterConfig entries of type "notification" (for channel picker UI) */
export async function getAvailableChannels() {
  return prisma.adapterConfig.findMany({
    where: { type: "notification" },
    select: { id: true, name: true, adapterId: true },
  });
}

// ── Notification Dispatch ──────────────────────────────────────

/**
 * Extract the target user's email from events that support per-user delivery.
 * Returns undefined when the event has no user email.
 */
function extractUserEmail(event: NotificationEventData): string | undefined {
  if (
    event.eventType === NOTIFICATION_EVENTS.USER_LOGIN ||
    event.eventType === NOTIFICATION_EVENTS.USER_CREATED
  ) {
    return (event.data as { email?: string }).email;
  }
  return undefined;
}

export interface NotifyOptions {
  executionId?: string;
  /** Sends even while the event is off, for Send a test, and only to the platform. */
  test?: boolean;
  /**
   * The tenant the event is about. Left out, it is found from the event: the run, the connection
   * or the destination it names, else the tenant the code runs for. Null for none.
   */
  tenantId?: string | null;
  /** False sends to the channels of the tenant alone, for a check of every tenant the platform heard about as a whole. */
  platform?: boolean;
  /** Channels of the tenant that heard about it already, like those of the job of a run, which get it once. */
  skipChannelIds?: readonly string[];
}

/** Both deliveries as one answer, none while neither had anywhere to send to. */
function combined(first: DeliveryResult | undefined, second: DeliveryResult | undefined): DeliveryResult | undefined {
  if (!first && !second) return undefined;
  return { succeeded: (first?.succeeded ?? 0) + (second?.succeeded ?? 0), failed: (first?.failed ?? 0) + (second?.failed ?? 0) };
}

/**
 * Sends an event to the channels of Settings > Notifications, which belong to the platform and
 * read every tenant, whoever caused the event. An event about the data of a tenant other than the
 * home tenant then also goes to the channels that tenant picked in its own settings, read in that
 * tenant, see `deliverToTenant`. Never throws, a caller is never held up by a channel.
 */
export async function notify(event: NotificationEventData, opts: NotifyOptions = {}): Promise<DeliveryResult | undefined> {
  // Found before the system scope of the platform, which would hide the tenant of a run.
  const tenantId = opts.test ? null : await eventTenant(event, opts).catch((err: unknown) => {
    log.warn("Finding the tenant of a notification failed", { eventType: event.eventType }, wrapError(err));
    return null;
  });
  const platform = opts.platform === false ? undefined : await runAsSystem(() => notifyChannels(event, opts));
  const tenant = tenantId
    ? await deliverToTenant(event, tenantId, { executionId: opts.executionId, skipChannelIds: opts.skipChannelIds }).catch((err: unknown) => {
        log.error("Tenant notification dispatch failed", { eventType: event.eventType, tenantId }, wrapError(err));
        return undefined;
      })
    : undefined;
  return combined(platform, tenant);
}

/**
 * Sends an event to the channels of the platform.
 *
 * 1. Loads the stored config to determine which channels are active.
 * 2. Checks if the event is enabled.
 * 3. Renders the template.
 * 4. Sends through each selected channel (adapter).
 * 5. If `notifyUser` is configured ("also" / "only"), sends an additional
 *    email directly to the affected user via any email-type channel.
 *
 * Failures are logged but never thrown, callers are never blocked by
 * notification delivery issues.
 */
async function notifyChannels(
  event: NotificationEventData,
  opts?: NotifyOptions
): Promise<DeliveryResult | undefined> {
  let succeeded = 0;
  let failed = 0;
  try {
    const config = await getNotificationConfig();

    // Determine if the event is enabled
    const eventConfig = config.events[event.eventType];
    const eventDef = getEventDefinition(event.eventType);

    // If no explicit config exists, fall back to the event's default
    const isEnabled = eventConfig
      ? eventConfig.enabled
      : eventDef?.defaultEnabled ?? false;

    if (!isEnabled && !opts?.test) {
      log.debug("System notification skipped (disabled)", {
        eventType: event.eventType,
      });
      return;
    }

    // Resolve channel IDs (event-level override or global)
    const channelIds = eventConfig?.channels ?? config.globalChannels;

    if (!channelIds || channelIds.length === 0) {
      log.debug("System notification skipped (no channels configured)", {
        eventType: event.eventType,
      });
      return;
    }

    // Render the template, in the time zone of the instance and with why the reader gets it
    const brand = await loadNotificationBrand();
    const reminderHours = eventConfig?.reminderIntervalHours ?? eventDef?.defaultReminderHours;
    const payload = {
      ...renderTemplate(event, { timeZone: brand.timeZone }),
      reason: eventReason(eventDef, reminderHours, !!opts?.test),
    };
    const sendOpts = { ...opts, brand };

    // Make sure adapters are registered
    registerAdapters();

    // Load channel configs
    // Only channels of the home tenant carry what the platform sends, even if a setting from
    // before tenants still names another.
    const channels = await prisma.adapterConfig.findMany({
      where: { id: { in: channelIds }, type: "notification", tenantId: HOME_TENANT_ID },
    });

    // Determine user-targeted delivery mode
    const notifyUser = eventConfig?.notifyUser ?? "none";
    const userEmail =
      notifyUser !== "none" && eventDef?.supportsNotifyUser
        ? extractUserEmail(event)
        : undefined;

    // ── Admin / normal channel delivery ────────────────────────
    if (notifyUser !== "only") {
      for (const channel of channels) {
        try {
          await sendThroughChannel(channel, payload, event.eventType, undefined, sendOpts);
          succeeded++;
        } catch (err) {
          log.error(
            "Failed to send system notification through channel",
            { channelName: channel.name, eventType: event.eventType },
            wrapError(err)
          );
          failed++;
        }
      }
    }

    // ── User-targeted email delivery ───────────────────────────
    if (userEmail && (notifyUser === "also" || notifyUser === "only")) {
      const emailChannels = channels.filter((ch) =>
        EMAIL_ADAPTER_IDS.includes(ch.adapterId)
      );

      if (emailChannels.length === 0) {
        log.debug(
          "User notification skipped (no email channel in selected channels)",
          { eventType: event.eventType }
        );
      }

      // The person gets the words meant for them, and the reason they get it.
      const userPayload = {
        ...renderTemplate(event, { timeZone: brand.timeZone, audience: "user" }),
        reason: userReason(event.eventType, brand.instanceName),
      };

      for (const channel of emailChannels) {
        try {
          await sendThroughChannel(
            channel,
            userPayload,
            event.eventType,
            userEmail,
            sendOpts
          );
          succeeded++;
        } catch (err) {
          log.error(
            "Failed to send user-targeted notification",
            {
              channelName: channel.name,
              eventType: event.eventType,
              userEmail,
            },
            wrapError(err)
          );
          failed++;
        }
      }
    }
  } catch (err) {
    log.error(
      "System notification dispatch failed",
      { eventType: event.eventType },
      wrapError(err)
    );
  }
  return { succeeded, failed };
}
