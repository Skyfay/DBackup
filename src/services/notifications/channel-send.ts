/**
 * Sends one notification through one channel and records it in the notification log, in the
 * tenant the message was sent for, which is the customer when the channel is one another tenant
 * shares, else in the tenant of the channel. Shared by the notifications of the platform and the
 * ones of a tenant.
 */

import { registry } from "@/lib/core/registry";
import { NotificationAdapter } from "@/lib/core/interfaces";
import { resolveAdapterConfig } from "@/lib/adapters/config-resolver";
import { logger } from "@/lib/logging/logger";
import { getErrorMessage } from "@/lib/logging/errors";
import { renderTemplate } from "@/lib/notifications/templates";
import { recordNotificationLog } from "@/services/notifications/notification-log-service";
import type { NotificationBrand } from "@/lib/notifications/brand";
import { EMAIL_ADAPTER_IDS } from "@/services/sharing/provided";
import { channelTarget } from "@/services/sharing/channel-recipients";

const log = logger.child({ service: "NotificationChannelSend" });

const NOTIFICATION_TIMEOUT_MS = 30_000;

/** What a customer reads when a channel another tenant shares fails, the cause stays with that tenant. */
export const SHARED_FAILURE = "The channel of the tenant that shares it did not take the message.";

function notifyWithTimeout(send: () => Promise<unknown>): Promise<unknown> {
    return Promise.race([
        send(),
        new Promise<never>((_, reject) =>
            setTimeout(
                () => reject(new Error("Notification send timed out after 30s")),
                NOTIFICATION_TIMEOUT_MS
            )
        ),
    ]);
}

/** Email adapter IDs that support per-user `to` override */
export { EMAIL_ADAPTER_IDS };

/**
 * Send a notification payload through a single adapter channel.
 * If `toOverride` is provided the email `to` field in the channel config is
 * replaced (used for user-targeted delivery).
 */
export async function sendThroughChannel(
  channel: { id: string; name: string; adapterId: string; config: string; primaryCredentialId: string | null; sshCredentialId: string | null; tenantId: string },
  payload: ReturnType<typeof renderTemplate>,
  eventType: string,
  toOverride?: string,
  opts?: { executionId?: string; brand?: NotificationBrand; tenantId?: string }
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

  // A message of a tenant through a channel another tenant shares goes where the tenant named, or nowhere.
  const target = await channelTarget(channel, opts?.tenantId);
  const logTenant = opts?.tenantId && channel.tenantId && opts.tenantId !== channel.tenantId ? opts.tenantId : undefined;
  if (target.refusal) {
    await recordNotificationLog({
      eventType,
      channelId: channel.id,
      channelName: channel.name,
      adapterId: channel.adapterId,
      status: "Failed",
      title: payload.title,
      message: payload.message,
      error: target.refusal,
      executionId: opts?.executionId,
      tenantId: logTenant,
    });
    throw new Error(target.refusal);
  }

  let channelConfig: Record<string, unknown>;
  try {
    channelConfig = await resolveAdapterConfig(channel) as Record<string, unknown>;
  } catch (err) {
    // Settings that are refused, like a host in a local network its tenant blocks, fail like a send:
    // logged, and for a customer in words that name nothing of the tenant that shares the channel.
    await recordNotificationLog({
      eventType,
      channelId: channel.id,
      channelName: channel.name,
      adapterId: channel.adapterId,
      status: "Failed",
      title: payload.title,
      message: payload.message,
      error: logTenant ? SHARED_FAILURE : getErrorMessage(err),
      executionId: opts?.executionId,
      tenantId: logTenant,
    });
    if (logTenant) {
      log.warn("The settings of a shared channel could not be used for a customer", { channelId: channel.id, tenantId: logTenant, error: getErrorMessage(err) });
      throw new Error(SHARED_FAILURE);
    }
    throw err;
  }
  if (target.to) channelConfig = { ...channelConfig, to: target.to };

  // Override the recipient for user-targeted emails
  if (toOverride && EMAIL_ADAPTER_IDS.includes(channel.adapterId)) {
    channelConfig = { ...channelConfig, to: toOverride };
  }

  // Build adapter-specific rendered payload for logging
  let renderedPayload: string | undefined;
  let renderedHtml: string | undefined;

  if (channel.adapterId === "email") {
    try {
      const { renderNotificationEmail } = await import("@/components/email/render-email");
      renderedHtml = (await renderNotificationEmail(payload, opts?.brand)).html;
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
    const sent = await notifyWithTimeout(() => adapter.send(channelConfig, payload.message, { ...payload, eventType, brand: opts?.brand }));
    if (sent === false) {
      throw new Error("Notification delivery failed (adapter returned false)");
    }

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
      executionId: opts?.executionId,
      tenantId: logTenant,
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
      // Why the server of the tenant that shares the channel refused it stays with that tenant.
      error: logTenant ? SHARED_FAILURE : getErrorMessage(err),
      executionId: opts?.executionId,
      tenantId: logTenant,
    });
    if (logTenant) {
      log.warn("A shared channel did not take a message of a customer", { channelId: channel.id, tenantId: logTenant, error: getErrorMessage(err) });
      throw new Error(SHARED_FAILURE);
    }
    throw err; // Re-throw so the caller handles it
  }

  log.info("System notification sent", {
    eventType,
    channelName: channel.name,
    adapterId: channel.adapterId,
    ...(toOverride ? { toOverride } : {}),
  });
}
