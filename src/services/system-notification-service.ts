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
import { registry } from "@/lib/core/registry";
import { NotificationAdapter } from "@/lib/core/interfaces";
import { decryptConfig } from "@/lib/crypto";
import { registerAdapters } from "@/lib/adapters";
import { logger } from "@/lib/logger";
import { wrapError, getErrorMessage } from "@/lib/errors";
import { renderTemplate } from "@/lib/notifications/templates";
import { getEventDefinition } from "@/lib/notifications/events";
import {
  NotificationEventData,
  SystemNotificationConfig,
  NOTIFICATION_EVENTS,
} from "@/lib/notifications/types";
import { recordNotificationLog } from "@/services/notification-log-service";

const log = logger.child({ service: "SystemNotificationService" });

const SETTING_KEY = "notifications.config";

/** Email adapter IDs that support per-user `to` override */
const EMAIL_ADAPTER_IDS = ["email"];

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

/**
 * Send a notification payload through a single adapter channel.
 * If `toOverride` is provided the email `to` field in the channel config is
 * replaced (used for user-targeted delivery).
 */
async function sendThroughChannel(
  channel: { id: string; name: string; adapterId: string; config: string },
  payload: ReturnType<typeof renderTemplate>,
  eventType: string,
  toOverride?: string
): Promise<void> {
  const adapter = registry.get(channel.adapterId) as
    | NotificationAdapter
    | undefined;

  if (!adapter) {
    log.warn("Adapter not found for notification channel", {
      channelId: channel.id,
      adapterId: channel.adapterId,
    });
    return;
  }

  let channelConfig = decryptConfig(JSON.parse(channel.config));

  // Override the recipient for user-targeted emails
  if (toOverride && EMAIL_ADAPTER_IDS.includes(channel.adapterId)) {
    channelConfig = { ...channelConfig, to: toOverride };
  }

  // Build adapter-specific rendered payload for logging
  let renderedPayload: string | undefined;
  let renderedHtml: string | undefined;

  if (channel.adapterId === "email") {
    try {
      const { renderToStaticMarkup } = await import("react-dom/server");
      const { SystemNotificationEmail } = await import(
        "@/components/email/system-notification-template"
      );
      const React = await import("react");
      renderedHtml = renderToStaticMarkup(
        React.createElement(SystemNotificationEmail, {
          title: payload.title,
          message: payload.message,
          fields: payload.fields,
          color: payload.color,
          success: payload.success,
          badge: payload.badge,
        })
      );
    } catch { /* non-critical */ }
  } else if (channel.adapterId === "discord") {
    const color = payload.color
      ? parseInt(payload.color.replace("#", ""), 16)
      : payload.success ? 0x00ff00 : 0xff0000;
    renderedPayload = JSON.stringify({
      embeds: [{
        title: payload.title || "Notification",
        description: payload.message,
        color,
        timestamp: new Date().toISOString(),
        fields: (payload.fields || []).map((f: { name: string; value: string; inline?: boolean }) => ({
          name: f.name, value: f.value, inline: f.inline ?? true,
        })),
      }],
    });
  } else if (channel.adapterId === "slack") {
    const colorHex = payload.color
      ? payload.color.replace("#", "")
      : payload.success ? "00ff00" : "ff0000";
    renderedPayload = JSON.stringify({
      attachments: [{
        color: `#${colorHex}`,
        blocks: [
          { type: "header", text: { type: "plain_text", text: payload.title || "Notification" } },
          { type: "section", text: { type: "mrkdwn", text: payload.message } },
          ...(payload.fields?.length ? [{
            type: "section",
            fields: payload.fields.map((f: { name: string; value: string }) => ({
              type: "mrkdwn", text: `*${f.name}:*\n${f.value || "-"}`,
            })),
          }] : []),
        ],
      }],
    });
  }

  try {
    await adapter.send(channelConfig, payload.message, {
      success: payload.success,
      eventType,
      title: payload.title,
      fields: payload.fields,
      color: payload.color,
      badge: payload.badge,
    });

    // Record successful send
    await recordNotificationLog({
      eventType,
      channelId: channel.id,
      channelName: channel.name,
      adapterId: channel.adapterId,
      status: "Success",
      title: payload.title,
      message: payload.message,
      fields: payload.fields,
      color: payload.color,
      renderedHtml,
      renderedPayload,
    });
  } catch (err) {
    // Record failed send
    await recordNotificationLog({
      eventType,
      channelId: channel.id,
      channelName: channel.name,
      adapterId: channel.adapterId,
      status: "Failed",
      title: payload.title,
      message: payload.message,
      fields: payload.fields,
      color: payload.color,
      error: getErrorMessage(err),
    });
    throw err; // Re-throw so the caller handles it
  }

  log.info("System notification sent", {
    eventType,
    channelName: channel.name,
    adapterId: channel.adapterId,
    ...(toOverride ? { toOverride } : {}),
  });
}

/**
 * Send a system notification for the given event.
 *
 * 1. Loads the stored config to determine which channels are active.
 * 2. Checks if the event is enabled.
 * 3. Renders the template.
 * 4. Sends through each selected channel (adapter).
 * 5. If `notifyUser` is configured ("also" / "only"), sends an additional
 *    email directly to the affected user via any email-type channel.
 *
 * Failures are logged but never thrown – callers should not be blocked by
 * notification delivery issues.
 */
export async function notify(event: NotificationEventData): Promise<void> {
  try {
    const config = await getNotificationConfig();

    // Determine if the event is enabled
    const eventConfig = config.events[event.eventType];
    const eventDef = getEventDefinition(event.eventType);

    // If no explicit config exists, fall back to the event's default
    const isEnabled = eventConfig
      ? eventConfig.enabled
      : eventDef?.defaultEnabled ?? false;

    if (!isEnabled) {
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

    // Render the template
    const payload = renderTemplate(event);

    // Make sure adapters are registered
    registerAdapters();

    // Load channel configs
    const channels = await prisma.adapterConfig.findMany({
      where: { id: { in: channelIds }, type: "notification" },
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
          await sendThroughChannel(channel, payload, event.eventType);
        } catch (err) {
          log.error(
            "Failed to send system notification through channel",
            { channelName: channel.name, eventType: event.eventType },
            wrapError(err)
          );
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

      for (const channel of emailChannels) {
        try {
          await sendThroughChannel(
            channel,
            payload,
            event.eventType,
            userEmail
          );
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
}
