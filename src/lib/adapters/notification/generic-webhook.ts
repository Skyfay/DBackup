import { NotificationAdapter } from "@/lib/core/interfaces";
import { GenericWebhookSchema, GenericWebhookConfig } from "@/lib/adapters/definitions";
import { logger } from "@/lib/logging/logger";
import { wrapError } from "@/lib/logging/errors";
import { validateOutboundUrl } from "@/lib/url-validation";

const log = logger.child({ adapter: "generic-webhook" });

/**
 * Generic webhook notification adapter.
 *
 * Sends a JSON payload to any HTTP endpoint. Compatible with services like
 * Ntfy, Gotify, Uptime Kuma, PagerDuty, and any custom HTTP receiver.
 *
 * The payload structure is:
 * {
 *   "title": "...",
 *   "message": "...",
 *   "success": true|false,
 *   "color": "#hex",
 *   "timestamp": "ISO-8601",
 *   "fields": [{ "name": "...", "value": "...", "inline": true }],
 *   "eventType": "backup_success" | "user_login" | ...
 * }
 *
 * Users can optionally provide a custom payload template using Go-style
 * `{{variable}}` placeholders that get replaced at send time.
 */
export const GenericWebhookAdapter: NotificationAdapter = {
    id: "generic-webhook",
    type: "notification",
    name: "Generic Webhook",
    configSchema: GenericWebhookSchema,
    credentials: { primary: "WEBHOOK" },

    async test(config: GenericWebhookConfig): Promise<{ success: boolean; message: string }> {
        try {
            validateOutboundUrl(config.webhookUrl);
            const headers = buildHeaders(config);

            const body = config.payloadTemplate
                ? renderTemplate(config.payloadTemplate, {
                      title: "DBackup Connection Test",
                      message: "This is a test notification to verify your webhook configuration.",
                      success: "true",
                      color: "#0078D4",
                      timestamp: new Date().toISOString(),
                      eventType: "test",
                      fields: "[]",
                  })
                : JSON.stringify({
                      title: "DBackup Connection Test",
                      message: "This is a test notification to verify your webhook configuration.",
                      success: true,
                      color: "#0078D4",
                      timestamp: new Date().toISOString(),
                      eventType: "test",
                      fields: [],
                  });

            const method = (config.method || "POST").toUpperCase();
            const fetchOpts: RequestInit = { method, headers };
            if (method !== "GET" && method !== "HEAD") {
                fetchOpts.body = body;
            }
            const response = await fetch(config.webhookUrl, fetchOpts);

            if (response.ok) {
                return { success: true, message: `Webhook returned ${response.status}` };
            } else {
                const responseBody = await response.text().catch(() => "");
                return {
                    success: false,
                    message: `Webhook returned ${response.status}: ${responseBody || response.statusText}`,
                };
            }
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            return { success: false, message: message || "Failed to connect to webhook endpoint" };
        }
    },

    async send(config: GenericWebhookConfig, message: string, context?: any): Promise<boolean> {
        try {
            validateOutboundUrl(config.webhookUrl);
            const headers = buildHeaders(config);
            const title = context?.title || "Notification";
            const success = context?.success ?? true;
            const color = context?.color || (success ? "#00ff00" : "#ff0000");
            const fields: Array<{ name: string; value: string; inline?: boolean }> = context?.fields || [];
            const eventType = context?.eventType || "";
            const timestamp = new Date().toISOString();

            let body: string;

            if (config.payloadTemplate) {
                body = renderTemplate(config.payloadTemplate, {
                    title,
                    message,
                    success: String(success),
                    color,
                    timestamp,
                    eventType,
                    fields: JSON.stringify(fields),
                });
            } else {
                body = JSON.stringify({
                    title,
                    message,
                    success,
                    color,
                    timestamp,
                    eventType: eventType || undefined,
                    fields: fields.length > 0 ? fields : undefined,
                });
            }

            const method = (config.method || "POST").toUpperCase();
            const fetchOpts: RequestInit = { method, headers };
            if (method !== "GET" && method !== "HEAD") {
                fetchOpts.body = body;
            }
            const response = await fetch(config.webhookUrl, fetchOpts);

            if (!response.ok) {
                const responseBody = await response.text().catch(() => "");
                log.warn("Webhook notification failed", { status: response.status, body: responseBody });
                return false;
            }

            return true;
        } catch (error) {
            log.error("Webhook notification error", {}, wrapError(error));
            return false;
        }
    },
};

/**
 * Build request headers from config. Always includes Content-Type.
 * Merges any custom headers provided by the user.
 */
function buildHeaders(config: GenericWebhookConfig): Record<string, string> {
    const headers: Record<string, string> = {
        "Content-Type": config.contentType || "application/json",
    };

    if (config.authHeader) {
        headers["Authorization"] = config.authHeader;
    }

    if (config.customHeaders) {
        // Parse "Key: Value" lines
        const lines = config.customHeaders.split("\n").filter((l) => l.trim());
        for (const line of lines) {
            const colonIdx = line.indexOf(":");
            if (colonIdx > 0) {
                const key = line.substring(0, colonIdx).trim();
                const value = line.substring(colonIdx + 1).trim();
                if (key && value) {
                    headers[key] = value;
                }
            }
        }
    }

    return headers;
}

/**
 * Replace `{{variable}}` placeholders in a template string with actual values.
 */
function renderTemplate(template: string, variables: Record<string, string>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
        return variables[key] ?? "";
    });
}
